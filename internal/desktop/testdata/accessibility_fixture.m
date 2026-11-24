#import <AppKit/AppKit.h>
@interface HCBFixture : NSObject <NSApplicationDelegate>
@property(nonatomic,retain) NSWindow *window;
@property(nonatomic,retain) NSTextField *field;
@end
@implementation HCBFixture
- (void)applicationDidFinishLaunching:(NSNotification *)notification {
 self.window=[[[NSWindow alloc]initWithContentRect:NSMakeRect(120,180,500,220) styleMask:NSWindowStyleMaskTitled backing:NSBackingStoreBuffered defer:NO]autorelease];
 self.window.title=@"HCB disposable acceptance fixture";
 self.field=[[[NSTextField alloc]initWithFrame:NSMakeRect(24,135,450,30)]autorelease];self.field.stringValue=@"Fixture draft";self.field.accessibilityLabel=@"Fixture draft";
 NSButton *button=[[[NSButton alloc]initWithFrame:NSMakeRect(24,65,160,32)]autorelease];button.title=@"Apply fixture";button.target=self;button.action=@selector(apply:);
 [self.window.contentView addSubview:self.field];[self.window.contentView addSubview:button];[self.window makeKeyAndOrderFront:nil];[NSApp activateIgnoringOtherApps:YES];
}
- (void)apply:(id)sender {self.field.stringValue=@"Applied fixture";}
@end
int main(void){@autoreleasepool{NSApplication *app=[NSApplication sharedApplication];app.activationPolicy=NSApplicationActivationPolicyRegular;HCBFixture *delegate=[[[HCBFixture alloc]init]autorelease];app.delegate=delegate;[app run];}return 0;}
