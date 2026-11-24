#import <AppKit/AppKit.h>
#import <ApplicationServices/ApplicationServices.h>
#include <math.h>
#include <stdlib.h>
#include <string.h>

static NSString *hcb_ax_string(AXUIElementRef element, CFStringRef attribute, NSUInteger limit) {
  CFTypeRef raw = NULL;
  if (AXUIElementCopyAttributeValue(element, attribute, &raw) != kAXErrorSuccess || raw == NULL) return @"";
  NSString *value = @"";
  if (CFGetTypeID(raw) == CFStringGetTypeID()) {
    NSString *text = (__bridge NSString *)raw;
    NSRange range = NSMakeRange(0, MIN(limit, text.length));
    if (range.length < text.length && range.length > 0 && CFStringIsSurrogateHighCharacter([text characterAtIndex:range.length-1])) range.length--;
    value = [[text substringWithRange:range] copy];
  } else { value = [@"" copy]; }
  CFRelease(raw);
  return [value autorelease];
}
static BOOL hcb_ax_bool(AXUIElementRef element, CFStringRef attribute, BOOL fallback) {
  CFTypeRef raw = NULL;
  if (AXUIElementCopyAttributeValue(element, attribute, &raw) != kAXErrorSuccess || raw == NULL) return fallback;
  BOOL value = CFGetTypeID(raw) == CFBooleanGetTypeID() ? CFBooleanGetValue((CFBooleanRef)raw) : fallback;
  CFRelease(raw); return value;
}
static BOOL hcb_ax_rect(AXUIElementRef window, double x, double y, double width, double height) {
  CFTypeRef position=NULL, size=NULL; CGPoint point=CGPointZero; CGSize dimensions=CGSizeZero;
  BOOL valid=AXUIElementCopyAttributeValue(window,kAXPositionAttribute,&position)==kAXErrorSuccess && AXUIElementCopyAttributeValue(window,kAXSizeAttribute,&size)==kAXErrorSuccess && position && size;
  valid=valid && CFGetTypeID(position)==AXValueGetTypeID() && CFGetTypeID(size)==AXValueGetTypeID() && AXValueGetValue(position,kAXValueCGPointType,&point) && AXValueGetValue(size,kAXValueCGSizeType,&dimensions);
  if(position)CFRelease(position);if(size)CFRelease(size);
  return valid && fabs(point.x-x)<2 && fabs(point.y-y)<2 && fabs(dimensions.width-width)<2 && fabs(dimensions.height-height)<2;
}
static NSString *hcb_ax_text(AXUIElementRef element, BOOL *truncated) {
  CFTypeRef count=NULL; long length=0;
  if(AXUIElementCopyAttributeValue(element,kAXNumberOfCharactersAttribute,&count)!=kAXErrorSuccess || !count || CFGetTypeID(count)!=CFNumberGetTypeID()) {if(count)CFRelease(count);NSString *text=hcb_ax_string(element,kAXValueAttribute,513);*truncated=text.length>512;return *truncated?[text substringToIndex:512]:text;}
  CFNumberGetValue((CFNumberRef)count,kCFNumberLongType,&length);CFRelease(count);
  if(length<0){*truncated=YES;return @"";}
  *truncated=length>512;
  if(length==0)return @"";
  CFRange range=CFRangeMake(0,MIN(length,512)); AXValueRef parameter=AXValueCreate(kAXValueCFRangeType,&range);CFTypeRef raw=NULL;
  AXError error=AXUIElementCopyParameterizedAttributeValue(element,kAXStringForRangeParameterizedAttribute,parameter,&raw);CFRelease(parameter);
  if(error!=kAXErrorSuccess || !raw || CFGetTypeID(raw)!=CFStringGetTypeID()){if(raw)CFRelease(raw);*truncated=YES;return @"";}
  NSString *text=[(__bridge NSString *)raw copy];CFRelease(raw);return [text autorelease];
}
static void hcb_ax_walk(AXUIElementRef element, NSArray *path, NSMutableArray *nodes, BOOL *truncated, BOOL *restricted, NSUInteger *budget, CFAbsoluteTime deadline) {
  if(nodes.count>=128 || path.count>12 || CFAbsoluteTimeGetCurrent()>deadline){*truncated=YES;return;}
  AXUIElementSetMessagingTimeout(element,0.15);
  NSString *role=hcb_ax_string(element,kAXRoleAttribute,128), *subrole=hcb_ax_string(element,kAXSubroleAttribute,128);
  if([role isEqualToString:@"AXSheet"] || [role isEqualToString:@"AXDialog"] || [subrole isEqualToString:@"AXSecureTextField"] || [subrole isEqualToString:@"AXSystemDialog"] || hcb_ax_bool(element,CFSTR("AXProtectedContent"),NO) || hcb_ax_bool(element,kAXModalAttribute,NO)){*restricted=YES;return;}
  if(role.length==0){*truncated=YES;return;}
  NSString *label=hcb_ax_string(element,kAXTitleAttribute,256);
  if(label.length==0)label=hcb_ax_string(element,kAXDescriptionAttribute,256);
  BOOL editable=[role isEqualToString:@"AXTextField"] || [role isEqualToString:@"AXTextArea"] || [role isEqualToString:@"AXComboBox"];
  BOOL valueTruncated=NO;NSString *value=@"";
  if(editable)value=hcb_ax_text(element,&valueTruncated);
  else if([role isEqualToString:@"AXStaticText"]){value=hcb_ax_string(element,kAXValueAttribute,512);valueTruncated=value.length>=512;}
  if(valueTruncated || label.length>=256)*truncated=YES;
  if([@[@"AXCheckBox",@"AXRadioButton",@"AXSlider",@"AXStepper",@"AXPopUpButton",@"AXProgressIndicator",@"AXSwitch"] containsObject:role]) {
    CFTypeRef scalar=NULL;if(AXUIElementCopyAttributeValue(element,kAXValueAttribute,&scalar)==kAXErrorSuccess && scalar){
      if(CFGetTypeID(scalar)==CFBooleanGetTypeID())value=CFBooleanGetValue((CFBooleanRef)scalar)?@"true":@"false";
      else if(CFGetTypeID(scalar)==CFNumberGetTypeID())value=[(__bridge NSNumber*)scalar stringValue];
      else if(CFGetTypeID(scalar)==CFStringGetTypeID())value=hcb_ax_string(element,kAXValueAttribute,256);
      CFRelease(scalar);
    }
  }
  NSUInteger bytes=[role lengthOfBytesUsingEncoding:NSUTF8StringEncoding]+[label lengthOfBytesUsingEncoding:NSUTF8StringEncoding]+[value lengthOfBytesUsingEncoding:NSUTF8StringEncoding];
  if(bytes>*budget){*truncated=YES;return;}*budget-=bytes;
  BOOL enabled=hcb_ax_bool(element,kAXEnabledAttribute,NO);NSMutableArray *actions=[NSMutableArray array];CFArrayRef names=NULL;
  if(enabled && AXUIElementCopyActionNames(element,&names)==kAXErrorSuccess && names){
    if(CFArrayContainsValue(names,CFRangeMake(0,CFArrayGetCount(names)),kAXPressAction))[actions addObject:@"press"];
    if(CFArrayContainsValue(names,CFRangeMake(0,CFArrayGetCount(names)),kAXIncrementAction))[actions addObject:@"increment"];
    if(CFArrayContainsValue(names,CFRangeMake(0,CFArrayGetCount(names)),kAXDecrementAction))[actions addObject:@"decrement"];
  }if(names)CFRelease(names);
  Boolean settable=false;
  if(enabled && editable && !valueTruncated && AXUIElementIsAttributeSettable(element,kAXValueAttribute,&settable)==kAXErrorSuccess && settable)[actions addObject:@"set_value"];
  [nodes addObject:@{@"path":path,@"role":role,@"label":label,@"value":value,@"enabled":@(enabled),@"actions":actions,@"value_truncated":@(valueTruncated)}];
  CFIndex count=0;AXError error=AXUIElementGetAttributeValueCount(element,kAXChildrenAttribute,&count);
  if(error==kAXErrorAttributeUnsupported || error==kAXErrorNoValue)return;
  if(error!=kAXErrorSuccess){*truncated=YES;return;}
  CFIndex limit=MIN(count,(CFIndex)(128-nodes.count));if(limit<count)*truncated=YES;
  if(limit<=0)return;
  CFArrayRef children=NULL;
  if(AXUIElementCopyAttributeValues(element,kAXChildrenAttribute,0,limit,&children)!=kAXErrorSuccess || !children){*truncated=YES;return;}
  for(CFIndex i=0;i<CFArrayGetCount(children);i++){
    AXUIElementRef child=(AXUIElementRef)CFArrayGetValueAtIndex(children,i);
    if(CFGetTypeID(child)!=AXUIElementGetTypeID()){*truncated=YES;continue;}
    hcb_ax_walk(child,[path arrayByAddingObject:@(i)],nodes,truncated,restricted,budget,deadline);
    if(*restricted)break;
  }CFRelease(children);
}
static NSString *hcb_ax_snapshot(int pid,double x,double y,double width,double height,AXUIElementRef *rootOut) {
  if(!AXIsProcessTrusted() || NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier!=pid)return nil;
  AXUIElementRef app=AXUIElementCreateApplication(pid);AXUIElementSetMessagingTimeout(app,0.15);CFTypeRef raw=NULL;
  AXError error=AXUIElementCopyAttributeValue(app,kAXFocusedWindowAttribute,&raw);CFRelease(app);
  if(error!=kAXErrorSuccess || !raw || CFGetTypeID(raw)!=AXUIElementGetTypeID()){if(raw)CFRelease(raw);return nil;}
  AXUIElementRef window=(AXUIElementRef)raw;
  if(!hcb_ax_rect(window,x,y,width,height)){CFRelease(window);return nil;}
  BOOL truncated=NO,restricted=hcb_ax_bool(window,kAXModalAttribute,NO);NSUInteger budget=16384;NSMutableArray *nodes=[NSMutableArray array];
  if(!restricted)hcb_ax_walk(window,@[],nodes,&truncated,&restricted,&budget,CFAbsoluteTimeGetCurrent()+3.0);
  NSDictionary *tree=@{@"title":hcb_ax_string(window,kAXTitleAttribute,256),@"elements":nodes,@"truncated":@(truncated),@"restricted":@(restricted)};
  NSData *json=[NSJSONSerialization dataWithJSONObject:tree options:NSJSONWritingSortedKeys error:nil];
  if(!json || json.length>131072){CFRelease(window);return nil;}
  if(rootOut)*rootOut=window;else CFRelease(window);
  return [[[NSString alloc]initWithData:json encoding:NSUTF8StringEncoding]autorelease];
}
char *hcb_desktop_accessibility_snapshot(int pid,double x,double y,double width,double height) {
  @autoreleasepool {NSString *json=hcb_ax_snapshot(pid,x,y,width,height,NULL);return json?strdup(json.UTF8String):NULL;}
}
int hcb_desktop_accessibility_perform(int pid,double x,double y,double width,double height,const char *witness,const int *path,int count,int action,const char *value) {
 @autoreleasepool {
  AXUIElementRef root=NULL;NSString *current=hcb_ax_snapshot(pid,x,y,width,height,&root);
  if(!current || !witness || ![current isEqualToString:[NSString stringWithUTF8String:witness]]){if(root)CFRelease(root);return 2;}
  if(count<0 || count>12){CFRelease(root);return 0;}
  AXUIElementRef target=root;CFRetain(target);
  for(int i=0;i<count;i++){
    CFArrayRef children=NULL;
    if(path[i]<0 || path[i]>4096 || AXUIElementCopyAttributeValues(target,kAXChildrenAttribute,path[i],1,&children)!=kAXErrorSuccess || !children || CFArrayGetCount(children)!=1){if(children)CFRelease(children);CFRelease(target);CFRelease(root);return 2;}
    AXUIElementRef next=(AXUIElementRef)CFArrayGetValueAtIndex(children,0);CFRetain(next);CFRelease(target);target=next;CFRelease(children);
  }
  BOOL allowed=NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier==pid;
  CFTypeRef focused=NULL;AXUIElementRef app=AXUIElementCreateApplication(pid);
  allowed=allowed && AXUIElementCopyAttributeValue(app,kAXFocusedWindowAttribute,&focused)==kAXErrorSuccess && focused && CFEqual(focused,root);
  if(focused)CFRelease(focused);CFRelease(app);
  NSString *role=hcb_ax_string(target,kAXRoleAttribute,128),*subrole=hcb_ax_string(target,kAXSubroleAttribute,128);
  allowed=allowed && ![subrole isEqualToString:@"AXSecureTextField"] && !hcb_ax_bool(target,CFSTR("AXProtectedContent"),NO) && hcb_ax_bool(target,kAXEnabledAttribute,NO);
  AXError result=kAXErrorIllegalArgument;
  if(allowed && action==4 && ([role isEqualToString:@"AXTextField"] || [role isEqualToString:@"AXTextArea"] || [role isEqualToString:@"AXComboBox"])){
    Boolean settable=false;BOOL truncated=NO;hcb_ax_text(target,&truncated);
    if(!truncated && AXUIElementIsAttributeSettable(target,kAXValueAttribute,&settable)==kAXErrorSuccess && settable && value){NSString *text=[NSString stringWithUTF8String:value];if(text)result=AXUIElementSetAttributeValue(target,kAXValueAttribute,(__bridge CFStringRef)text);}
  }else if(allowed && action>=1 && action<=3){CFStringRef name=action==1?kAXPressAction:action==2?kAXIncrementAction:kAXDecrementAction;result=AXUIElementPerformAction(target,name);}
  CFRelease(target);CFRelease(root);
  return result==kAXErrorSuccess?1:result==kAXErrorCannotComplete?3:0;
 }
}
char *hcb_desktop_applications(void) {
 @autoreleasepool {
  NSMutableArray *apps=[NSMutableArray array];
  for(NSRunningApplication *app in NSWorkspace.sharedWorkspace.runningApplications) {
   if(app.activationPolicy==NSApplicationActivationPolicyRegular && app.bundleIdentifier.length>0 && apps.count<128)
    [apps addObject:@{@"bundle_id":app.bundleIdentifier,@"name":app.localizedName?:app.bundleIdentifier}];
  }
  NSData *data=[NSJSONSerialization dataWithJSONObject:apps options:0 error:nil];
  if(!data || data.length>131072)return NULL;
  NSString *json=[[[NSString alloc]initWithData:data encoding:NSUTF8StringEncoding]autorelease];return strdup(json.UTF8String);
 }
}
