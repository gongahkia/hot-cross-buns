// Swift-side bridging header. Imports the C ABI from
// `crates/melon-pan-mac-ffi/include/melon_pan_mac_ffi.h` so every
// Swift file in MelonPan/ can call the runtime without further
// import boilerplate.

#import "melon_pan_mac_ffi.h"
