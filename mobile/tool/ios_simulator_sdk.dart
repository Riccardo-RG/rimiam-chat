import 'dart:io';

/// Xcode 26.0 lacks one Foundation declaration used by device_info_plus 13.
/// The plugin already gates the message at runtime. Limit the declaration to
/// that SwiftPM target and the old simulator SDK. Device builds use Xcode 26.1+.
Future<void> writeSimulatorSDKCompatibility(Directory host) async {
  final folder = Directory('${host.absolute.path}/ios/Flutter');
  final header = File('${folder.path}/RimiamSimulatorSDK26.h');
  await header.writeAsString('''
#if defined(__OBJC__) && defined(__APPLE__)
#import <TargetConditionals.h>
#import <Availability.h>
#if TARGET_OS_SIMULATOR && TARGET_OS_IOS && __IPHONE_OS_VERSION_MAX_ALLOWED < 260100
#import <Foundation/NSProcessInfo.h>
@interface NSProcessInfo (RimiamDeviceInfoSDK26Compatibility)
@property (readonly, getter=isiOSAppOnVision) BOOL iOSAppOnVision API_AVAILABLE(ios(26.1));
@end
#endif
#endif
''');
  final escaped = header.path.replaceAll(r'\', r'\\').replaceAll('"', r'\"');
  await File('${folder.path}/RimiamSimulatorSDK26.xcconfig').writeAsString(
    'RIMIAM_COMPAT_device_info_plus = -include "$escaped"\n'
    r'OTHER_CFLAGS[sdk=iphonesimulator26.0*] = $(inherited) $(RIMIAM_COMPAT_$(TARGET_NAME))'
    '\n',
  );
}
