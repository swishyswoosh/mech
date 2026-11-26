import Foundation
import CoreBluetooth

// A single local controller owns this client. No motion, wake, or configuration
// is sent here: the shared R2Controller supplies the protocol initialization sequence.
final class BluetoothEngine:NSObject,CBCentralManagerDelegate,CBPeripheralDelegate {
 let services=[CBUUID(string:"00010001-574f-4f20-5370-6865726f2121"),CBUUID(string:"00020001-574f-4f20-5370-6865726f2121")]
 var central:CBCentralManager!
 var droid:CBPeripheral?
 let preferences=UserDefaults(suiteName:"local.r2controller.desktop")!
 var knownId:UUID?
 var knownName:String?
 func isR2(_ name:String?)->Bool {guard let name=name else{return false};return name.range(of:"^(D2|R2)-[A-Z0-9-]+$",options:[.regularExpression,.caseInsensitive]) != nil}
 func reportDroid(){if let id=knownId,let name=knownName {emit(["event":"droid","id":id.uuidString,"name":name])}}
 var characteristics=[String:CBCharacteristic]()
 var discovering:Int?
 var remainingServices=0
 var operation:(id:Int,method:String,characteristic:CBCharacteristic)?
 var chunks=[Data]()
 var closing:Int?
 override init(){super.init();knownId=(preferences.string(forKey:"droidId") ?? preferences.string(forKey:"robotId")).flatMap(UUID.init(uuidString:));knownName=preferences.string(forKey:"droidName") ?? preferences.string(forKey:"robotName");reportDroid();central=CBCentralManager(delegate:self,queue:nil,options:[CBCentralManagerOptionShowPowerAlertKey:false])}
 func emit(_ message:[String:Any]){if let bytes=try? JSONSerialization.data(withJSONObject:message,options:[.sortedKeys]),let line=String(data:bytes,encoding:.utf8){print(line);fflush(stdout)}}
 func reply(_ id:Int,_ result:Any=NSNull()){emit(["id":id,"result":result])}
 func fail(_ id:Int,_ message:String){emit(["id":id,"error":message])}
 func key(_ c:CBCharacteristic)->String{"\(c.service!.uuid.uuidString.lowercased())/\(c.uuid.uuidString.lowercased())"}
 func cancelPending(_ reason:String){if let id=discovering {fail(id,reason);discovering=nil};if let op=operation {fail(op.id,reason);operation=nil};chunks=[]}
 func handle(_ request:[String:Any]){
  guard let id=request["id"] as? Int,let method=request["method"] as? String else{return}
  if method == "disconnect" {
   cancelPending("Connection closed");central.stopScan();characteristics=[:]
   if let p=droid,p.state != .disconnected {closing=id;central.cancelPeripheralConnection(p)}else{droid=nil;reply(id)}
   return
  }
  guard closing == nil,operation == nil,discovering == nil else{fail(id,"Bluetooth operation already in progress");return}
  if method == "discover" {
   guard central.state == .poweredOn else{fail(id,"Native Bluetooth is not powered on or authorized");return}
   if droid?.state != .connected && central.retrieveConnectedPeripherals(withServices:services).contains(where:{isR2($0.name)||$0.identifier==knownId}) {fail(id,"An existing droid connection is preserved. Close its control session before switching transports.");return}
   discovering=id;characteristics=[:]
   if let p=droid,p.state == .connected {p.discoverServices(services);return}
   if let uuid=knownId,let p=central.retrievePeripherals(withIdentifiers:[uuid]).first {droid=p;p.delegate=self;central.connect(p,options:nil)}
   else{central.scanForPeripherals(withServices:nil,options:nil)}
   return
  }
  guard let p=droid,p.state == .connected,let ref=request["ref"] as? [String:String],let s=ref["service"],let c=ref["characteristic"],let characteristic=characteristics["\(s.lowercased())/\(c.lowercased())"] else{fail(id,"Bluetooth characteristic unavailable");return}
  operation=(id,method,characteristic)
  switch method {
  case "read":p.readValue(for:characteristic)
  case "subscribe":p.setNotifyValue(true,for:characteristic)
  case "unsubscribe":p.setNotifyValue(false,for:characteristic)
  case "write","emergency":
   let frames=method == "write" ? [request["data"] as? String ?? ""] : request["frames"] as? [String] ?? []
   chunks=[]
   for encoded in frames {guard let bytes=Data(base64Encoded:encoded) else{operation=nil;fail(id,"Invalid byte payload");return};for start in stride(from:0,to:bytes.count,by:20){chunks.append(bytes.subdata(in:start..<min(start+20,bytes.count)))}}
   writeNext()
  default:operation=nil;fail(id,"Unsupported Bluetooth operation")
  }
 }
 func writeNext(){guard let op=operation,let p=droid else{return};if chunks.isEmpty{operation=nil;reply(op.id);return};p.writeValue(chunks.removeFirst(),for:op.characteristic,type:.withResponse)}
 func centralManagerDidUpdateState(_ manager:CBCentralManager){emit(["event":"adapter","state":manager.state.rawValue]);if manager.state != .poweredOn && manager.state != .unknown && manager.state != .resetting {cancelPending("Bluetooth adapter unavailable")}}
 func centralManager(_ manager:CBCentralManager,didDiscover p:CBPeripheral,advertisementData:[String:Any],rssi:NSNumber){
  let name=advertisementData[CBAdvertisementDataLocalNameKey] as? String ?? p.name ?? ""
  guard discovering != nil,isR2(name) else{return}
  manager.stopScan();droid=p;knownName=name;p.delegate=self;manager.connect(p,options:nil)
 }
 func centralManager(_ manager:CBCentralManager,didConnect p:CBPeripheral){guard p === droid,discovering != nil,closing == nil else{manager.cancelPeripheralConnection(p);return};p.discoverServices(services)}
 func centralManager(_ manager:CBCentralManager,didFailToConnect p:CBPeripheral,error:Error?){guard p === droid else{return};cancelPending("Native Bluetooth connect failed: \(String(describing:error))");if let id=closing{closing=nil;reply(id)}}
 func centralManager(_ manager:CBCentralManager,didDisconnectPeripheral p:CBPeripheral,error:Error?){guard p === droid else{return};cancelPending("Native Bluetooth disconnected");characteristics=[:];emit(["event":"disconnected","detail":String(describing:error)]);if let id=closing{closing=nil;reply(id)}}
 func peripheral(_ p:CBPeripheral,didDiscoverServices error:Error?){
  guard p === droid,let id=discovering else{return}
  if let error=error{discovering=nil;fail(id,"Service discovery: \(error)");return}
  let available=(p.services ?? []).filter{services.contains($0.uuid)};remainingServices=available.count
  if available.isEmpty{discovering=nil;fail(id,"Droid services missing");return}
  for service in available{p.discoverCharacteristics(nil,for:service)}
 }
 func peripheral(_ p:CBPeripheral,didDiscoverCharacteristicsFor service:CBService,error:Error?){
  guard p === droid,let id=discovering else{return}
  if let error=error{discovering=nil;fail(id,"Characteristic discovery: \(error)");return}
  for c in service.characteristics ?? []{characteristics[key(c)]=c}
  remainingServices-=1
  if remainingServices == 0 {knownId=p.identifier;knownName=p.name ?? knownName ?? "R2 droid";preferences.set(p.identifier.uuidString,forKey:"droidId");preferences.set(knownName,forKey:"droidName");reportDroid();discovering=nil;reply(id,characteristics.values.map{["service":$0.service!.uuid.uuidString.lowercased(),"characteristic":$0.uuid.uuidString.lowercased()]})}
 }
 func peripheral(_ p:CBPeripheral,didUpdateValueFor c:CBCharacteristic,error:Error?){
  guard p === droid else{return}
  if let op=operation,op.method == "read",op.characteristic === c{operation=nil;if let error=error{fail(op.id,"Read: \(error)")}else{reply(op.id,(c.value ?? Data()).base64EncodedString())};return}
  if error == nil,let data=c.value{emit(["event":"notification","key":key(c),"data":data.base64EncodedString()])}
 }
 func peripheral(_ p:CBPeripheral,didUpdateNotificationStateFor c:CBCharacteristic,error:Error?){guard p === droid,let op=operation,["subscribe","unsubscribe"].contains(op.method),op.characteristic === c else{return};operation=nil;if let error=error{fail(op.id,"Notifications: \(error)")}else{reply(op.id)}}
 func peripheral(_ p:CBPeripheral,didWriteValueFor c:CBCharacteristic,error:Error?){guard p === droid,let op=operation,["write","emergency"].contains(op.method),op.characteristic === c else{return};if let error=error{operation=nil;chunks=[];fail(op.id,"Write: \(error)")}else{writeNext()}}
}
let engine=BluetoothEngine()
DispatchQueue.global().async {
 while let line=readLine(){guard let data=line.data(using:.utf8),let request=(try? JSONSerialization.jsonObject(with:data)) as? [String:Any] else{continue};DispatchQueue.main.async{engine.handle(request)}}
 DispatchQueue.main.async {engine.central.stopScan();if let p=engine.droid{engine.central.cancelPeripheralConnection(p)};exit(0)}
}
RunLoop.current.run()
