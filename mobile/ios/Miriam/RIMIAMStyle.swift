import SwiftUI

enum RIMIAMStyle {
  static let page = adaptive(light:0xF7F8F5,dark:0x111613)
  static let surface = adaptive(light:0xFFFFFF,dark:0x1A211C)
  static let raised = adaptive(light:0xEDF1EA,dark:0x253028)
  static let ink = adaptive(light:0x202A23,dark:0xEDF3EC)
  static let muted = adaptive(light:0x5D6C61,dark:0xB0BEB3)
  static let line = adaptive(light:0x89988C,dark:0x627568)
  static let accent = adaptive(light:0x087443,dark:0x8DDBAB)
  static let onAccent = adaptive(light:0xFFFFFF,dark:0x103821)
  static let secondary = adaptive(light:0x713AB7,dark:0xC5A3F0)
  static let secondarySurface = adaptive(light:0xF1EAF9,dark:0x30253F)
  static let orange = adaptive(light:0xA94B00,dark:0xFFBD76)
  static let orangeSurface = adaptive(light:0xFFF0DF,dark:0x3B2D1D)

  private static func adaptive(light:UInt32,dark:UInt32) -> Color {
    Color(uiColor:UIColor { traits in
      let rgb = traits.userInterfaceStyle == .dark ? dark : light
      return UIColor(red:CGFloat((rgb >> 16) & 0xFF)/255,
        green:CGFloat((rgb >> 8) & 0xFF)/255,blue:CGFloat(rgb & 0xFF)/255,alpha:1)
    })
  }
}

struct RIMIAMBrandMark: View {
  var body: some View {
    Image("RIMIAMMark").resizable().renderingMode(.original).scaledToFit()
      .frame(width:44,height:44).accessibilityHidden(true)
  }
}

struct RIMIAMRule: View {
  var strong = false
  var body: some View {
    Rectangle().fill(RIMIAMStyle.line.opacity(strong ? 1 : 0.4)).frame(height:strong ? 2 : 1)
      .accessibilityHidden(true)
  }
}

struct RIMIAMNavigationLabel: View {
  let title:String
  let subtitle:String
  let symbol:String
  var index:String? = nil
  var body: some View {
    HStack(alignment:.top,spacing:16) {
      if let index {Text(index).font(.system(.caption,design:.monospaced).weight(.bold)).foregroundStyle(RIMIAMStyle.muted).frame(width:24,alignment:.leading).padding(.top,5)}
      VStack(alignment:.leading,spacing:5) {
        Text(title).font(.system(.title3,design:.serif).weight(.bold)).foregroundStyle(RIMIAMStyle.ink)
        Text(subtitle).font(.subheadline).foregroundStyle(RIMIAMStyle.muted).fixedSize(horizontal:false,vertical:true)
      }
      Spacer(minLength:8)
      Image(systemName:symbol).font(.title3.weight(.medium)).foregroundStyle(RIMIAMStyle.ink).padding(.top,2).accessibilityHidden(true)
    }.padding(.vertical,10).accessibilityElement(children:.combine)
  }
}

struct RIMIAMPrimaryButtonStyle: ButtonStyle {
  @Environment(\.isEnabled) private var enabled
  func makeBody(configuration:Configuration) -> some View {
    configuration.label.font(.headline).frame(maxWidth:.infinity,minHeight:44)
      .padding(.horizontal,14).padding(.vertical,4)
      .foregroundStyle(enabled ? RIMIAMStyle.onAccent : RIMIAMStyle.muted)
      .background((enabled ? RIMIAMStyle.accent : RIMIAMStyle.raised).opacity(configuration.isPressed ? 0.85 : 1),in:RoundedRectangle(cornerRadius:10))
  }
}

private struct RIMIAMListStyle: ViewModifier {
  func body(content:Content) -> some View {
    content.listStyle(.insetGrouped).scrollContentBackground(.hidden)
      .background(RIMIAMStyle.page).listSectionSpacing(22)
      .listRowSeparatorTint(RIMIAMStyle.line.opacity(0.45)).tint(RIMIAMStyle.accent)
  }
}
extension View {
  func rimiamList() -> some View {modifier(RIMIAMListStyle())}
}

enum RIMIAMLensRoute: String, Hashable {
  case goal, context, work, outputs, sources, people, calendar, email, questions, streams, collaboration
}
