export type DiscoveredDroid = {id:string;name:string|null;rssi:number;serviceUuids?:string[]};
const droidServices=new Set(['00010001-574f-4f20-5370-6865726f2121','00020001-574f-4f20-5370-6865726f2121']);
export function droidCandidate(device:DiscoveredDroid):boolean {
 return /^(?:D2-[0-9a-f]{4}|R2[- ]?D2(?:\b.*)?)$/i.test(device.name?.trim()??'')
  || !!device.serviceUuids?.some(uuid=>droidServices.has(uuid.toLowerCase()));
}
/** Stable row order matters: changing RSSI must not move choices under a finger. */
export function visibleDevices(devices:readonly DiscoveredDroid[],showAll=false):DiscoveredDroid[]{
 const rank=(d:DiscoveredDroid)=>/^D2-[0-9a-f]{4}$/i.test(d.name?.trim()??'')?0:droidCandidate(d)?1:d.name?.trim()?2:3;
 return devices.filter(d=>showAll||d.name?.trim()||droidCandidate(d)).sort((a,b)=>rank(a)-rank(b)||(a.name??'').localeCompare(b.name??'')||a.id.localeCompare(b.id));
}
/** Scan responses can omit a name or service list already received for this ID. */
export function mergeDevice(devices:readonly DiscoveredDroid[],next:DiscoveredDroid):DiscoveredDroid[]{
 const prior=devices.find(d=>d.id===next.id);
 const merged={...prior,...next,name:next.name?.trim()||prior?.name||null,
 serviceUuids:[...new Set([...(prior?.serviceUuids??[]),...(next.serviceUuids??[])])]};
 return prior?devices.map(d=>d.id===next.id?merged:d):[...devices,merged];
}
