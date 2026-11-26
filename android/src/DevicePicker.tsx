import React,{useEffect,useMemo,useState} from 'react';
import {Modal,NativeModules,SafeAreaView,View,Text,Pressable,FlatList} from 'react-native';
import {paletteFor} from '../../app/theme/appearance.ts';
import {visibleDevices,droidCandidate} from './devicePicker.ts';
import type {DiscoveredDroid} from './devicePicker.ts';
export function DevicePicker({devices,appearance,onChoose,onCancel}:{
 devices:DiscoveredDroid[];appearance:'light'|'dark';onChoose:(d:DiscoveredDroid)=>void;onCancel:()=>void;
}){
 const colors=paletteFor(appearance),[showAll,setShowAll]=useState(false);
 const shown=useMemo(()=>visibleDevices(devices,showAll),[devices,showAll]);
 const hidden=devices.length-shown.length;
 useEffect(()=>{
  // Follow Android's rotation setting while choosing; restore the controller's
  // previous landscape request on selection, cancellation, error or unmount.
  NativeModules.R2CockpitPlatform?.setDevicePicker(true);
  return ()=>NativeModules.R2CockpitPlatform?.setDevicePicker(false);
 },[]);
 const button={minHeight:44,padding:12,borderWidth:1,borderRadius:8,borderColor:colors.line2,backgroundColor:colors.panel};
 return <Modal visible onRequestClose={onCancel} animationType="none" supportedOrientations={['portrait','landscape']}>
  <SafeAreaView style={{flex:1,backgroundColor:colors.bg}}>
   <View style={{flex:1,padding:16,paddingVertical:24,gap:10}}>
    <Text accessibilityRole="header" style={{color:colors.text,fontSize:22,fontWeight:'700'}}>Choose a Bluetooth droid</Text>
    <Text style={{color:colors.textMuted,fontSize:13}}>Likely R2 droids first · scanning for 15 seconds.</Text>
    <View style={{flexDirection:'row',alignItems:'center',gap:10}}>
     <Text style={{flex:1,color:colors.textMuted,fontSize:12}}>{shown.length} devices{hidden>0?` · ${hidden} unnamed hidden`:''}</Text>
     <Pressable accessibilityRole="button" accessibilityLabel={showAll?'Hide unnamed devices':'Show all devices'} onPress={()=>setShowAll(!showAll)} style={button}>
      <Text style={{color:colors.primary,fontSize:13}}>{showAll?'Hide unnamed devices':'Show all devices'}</Text>
     </Pressable>
    </View>
    <FlatList style={{flex:1,minHeight:0}} data={shown} keyExtractor={d=>d.id} initialNumToRender={12}
     contentContainerStyle={{gap:8,paddingBottom:4}} keyboardShouldPersistTaps="handled"
     ListEmptyComponent={<Text style={{color:colors.textMuted,paddingVertical:16}}>No named droids found yet. Show all devices to include unnamed devices.</Text>}
     renderItem={({item})=><Pressable accessibilityRole="button" accessibilityLabel={`Select ${item.name||'Unnamed device'}`} onPress={()=>onChoose(item)}
      style={[button,{borderColor:droidCandidate(item)?colors.primary:colors.line2}]}>
       <View style={{flexDirection:'row',alignItems:'center',gap:8}}>
        <Text style={{flex:1,color:colors.text,fontSize:16,fontWeight:'600'}}>{item.name||'Unnamed device'}</Text>
        {droidCandidate(item)&&<Text style={{color:colors.primary,fontSize:11}}>Likely R2</Text>}
       </View>
       <Text style={{color:colors.textMuted,fontSize:12,marginTop:4}}>{item.id} · {item.rssi} dBm</Text>
     </Pressable>}/>
    <Pressable accessibilityRole="button" accessibilityLabel="Cancel droid selection" onPress={onCancel} style={button}>
     <Text style={{color:colors.text,textAlign:'center'}}>Cancel</Text>
    </Pressable>
   </View>
  </SafeAreaView>
 </Modal>;
}
