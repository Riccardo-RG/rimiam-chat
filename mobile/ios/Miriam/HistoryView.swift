import SwiftUI

struct WorkHistoryView: View {
  let raw: String
  private var payload: [String:Any] { (try? JSONSerialization.jsonObject(with:Data(raw.utf8))) as? [String:Any] ?? [:] }
  var body: some View {
    VStack(alignment:.leading,spacing:12) {
      section("Contratti",key:"contracts",headline:"objective",detail:["version","scope","expectedOutput","anchors","focus","actor","origin","sourceId","reason","createdAt"])
      section("Eventi",key:"events",headline:"content",detail:["kind","revision","contractVersion","actor","sourceId","createdAt"])
      section("Fonti utilizzate",key:"inputs",headline:"content",detail:["kind","version","generation","qualification","key","provenance"])
      section("Contributi non adottati",key:"contributions",headline:"body",detail:["id","contractVersion","generation","qualification","citations","createdAt"])
    }
  }
  @ViewBuilder func section(_ title:String,key:String,headline:String,detail:[String]) -> some View {
    let rows=payload[key] as? [[String:Any]] ?? []
    if !rows.isEmpty { DisclosureGroup(title) { ForEach(Array(rows.enumerated()),id:\.offset) { _,row in
      VStack(alignment:.leading,spacing:4) {Text(row[headline] as? String ?? title);ForEach(detail,id:\.self) {name in if let value=row[name], !(value is NSNull) {Text("\(name): \(String(describing:value))").font(.caption).foregroundStyle(.secondary)} }}.padding(.vertical,4)
    } } }
  }
}
