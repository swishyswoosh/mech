package local.r2controller;
import java.io.*;
import java.nio.ByteBuffer;
import java.nio.charset.*;
import java.security.*;
/** Bounded local document decoding and content hashes. No network access. */
public final class LocalContent {
 private LocalContent(){}
 public static String readJson(InputStream stream) throws IOException {
  ByteArrayOutputStream output=new ByteArrayOutputStream();byte[] buffer=new byte[8192];int count;
  while((count=stream.read(buffer))!=-1){if(output.size()+count>2_000_000)throw new IOException("Local JSON pack is limited to 2 MB");output.write(buffer,0,count);}
  try{return StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(output.toByteArray())).toString();}
  catch(CharacterCodingException error){throw new IOException("Local JSON must be valid UTF-8",error);}
 }
 public static int utf8Size(String text){return text.getBytes(StandardCharsets.UTF_8).length;}
 public static void writeJson(OutputStream stream,String text) throws IOException {byte[] bytes=text.getBytes(StandardCharsets.UTF_8);if(bytes.length>2_000_000)throw new IOException("Local JSON export is limited to 2 MB");stream.write(bytes);stream.flush();}
 public static void commitJson(OutputStream stream,String text) throws IOException {
  if(stream==null)throw new IOException("Selected destination is unavailable");
  try(OutputStream owned=stream){writeJson(owned,text);}
 }
 public static String sha256(String text) throws NoSuchAlgorithmException {
  byte[] digest=MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8));StringBuilder hex=new StringBuilder();for(byte b:digest)hex.append(String.format(java.util.Locale.ROOT,"%02x",b&255));return hex.toString();
 }
}
