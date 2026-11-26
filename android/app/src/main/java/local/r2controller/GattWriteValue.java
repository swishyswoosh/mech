package local.r2controller;
/** Android13+ writes carry their own bytes; notification values cannot replace them. */
final class GattWriteValue {
 interface Writer { int explicitValue(byte[] value,int type); }
 static boolean submit(byte[] value,int type,Writer writer){return writer.explicitValue(value.clone(),type)==0;}
}
