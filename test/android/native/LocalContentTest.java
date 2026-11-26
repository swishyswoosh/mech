import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import local.r2controller.LocalContent;
public final class LocalContentTest {
 public static void main(String[] args) throws Exception {
  if(!LocalContent.sha256("abc").equals("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"))throw new AssertionError("SHA-256 differs from standard vector");
  if(LocalContent.utf8Size("é")!=2)throw new AssertionError("UTF-8 byte count");
  if(!LocalContent.readJson(new ByteArrayInputStream("{\"title\":\"é\"}".getBytes(StandardCharsets.UTF_8))).equals("{\"title\":\"é\"}"))throw new AssertionError("UTF-8 round trip");
  try{LocalContent.readJson(new ByteArrayInputStream(new byte[2_000_001]));throw new AssertionError("Oversized file accepted");}catch(java.io.IOException expected){}
  try{LocalContent.readJson(new ByteArrayInputStream(new byte[]{(byte)0xc3,0x28}));throw new AssertionError("Malformed UTF-8 accepted");}catch(java.io.IOException expected){}
  java.io.ByteArrayOutputStream saved=new java.io.ByteArrayOutputStream();LocalContent.writeJson(saved,"{\"title\":\"é\"}");
  if(!LocalContent.readJson(new ByteArrayInputStream(saved.toByteArray())).equals("{\"title\":\"é\"}"))throw new AssertionError("Export round trip");
  try{LocalContent.writeJson(saved,"x".repeat(2_000_001));throw new AssertionError("Oversized export accepted");}catch(java.io.IOException expected){}
  String boundary="é".repeat(1_000_000);java.io.ByteArrayOutputStream exact=new java.io.ByteArrayOutputStream();LocalContent.writeJson(exact,boundary);
  if(exact.size()!=2_000_000||!LocalContent.readJson(new ByteArrayInputStream(exact.toByteArray())).equals(boundary))throw new AssertionError("Exact UTF-8 boundary failed round trip");
  try{LocalContent.writeJson(exact,boundary+"x");throw new AssertionError("UTF-8 export overflow accepted");}catch(java.io.IOException expected){}
  final boolean[] committed={false};
  LocalContent.commitJson(new java.io.ByteArrayOutputStream(){@Override public void close(){committed[0]=true;}},"{}");
  if(!committed[0])throw new AssertionError("Commit returned before closing destination");
  try{LocalContent.commitJson(new java.io.OutputStream(){public void write(int b){}public void close()throws java.io.IOException{throw new java.io.IOException("provider commit failed");}},"{}");throw new AssertionError("Close failure reported as committed");}catch(java.io.IOException expected){if(!expected.getMessage().contains("provider commit failed"))throw expected;}
  System.out.println("Local content checks passed");
 }
}
