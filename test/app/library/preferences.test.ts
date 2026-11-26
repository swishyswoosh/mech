import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultsHudPreferences,
  validateHudPreferences,
  parseHudPreferences,
  pinSoundboard,
  saveHudPreferences,
  loadHudPreferences,
} from "../../../app/library/preferences.ts";
import { libraryItem, searchLibrary, libraryItems } from "../../../app/library/catalog.ts";
import {
  lightPreset,
  colorToChannels,
  selectedLightCommand,
} from "../../../app/library/lights.ts";

test("corrupt saved preferences restore defaults without sharing mutable slots", () => {
  const first = parseHudPreferences("{bad");
  first.soundboard[0] = null;
  assert.equal(parseHudPreferences(null).soundboard[0], "sound:184");
  assert.deepEqual(
    parseHudPreferences(
      JSON.stringify({ gearSpeeds: [0, 101, 3], soundboard: ["sound:999999"] }),
    ).gearSpeeds,
    [25, 50, 100],
  );
});
test("pinning changes one slot and roundtrips through the real preference contract", () => {
  const map = new Map<string, string>();
  const store = {
    loadPreference: (k: string) => map.get(k) ?? null,
    savePreference: (k: string, v: string) => {
      map.set(k, v);
    },
  };
  const next = pinSoundboard(defaultsHudPreferences(), 7, "animation:13");
  saveHudPreferences(store, next);
  assert.deepEqual(loadHudPreferences(store).soundboard, [
    "sound:184",
    "sound:207",
    "sound:42",
    "sound:232",
    "sound:139",
    "sound:151",
    "animation:21",
    "animation:13",
    "animation:13",
  ]);
  assert.throws(() => pinSoundboard(next, 9, "sound:42"));
  assert.throws(() => pinSoundboard(next, 0, "sound:99999"));
});
test("custom keys and gamepad buttons survive, invalid or duplicate keys do not", () => {
  const prefs = defaultsHudPreferences();
  prefs.input.keys.driveUp = "KeyI";
  prefs.input.gamepad.slot1 = 7;
  assert.equal(
    parseHudPreferences(JSON.stringify(prefs)).input.keys.driveUp,
    "KeyI",
  );
  assert.equal(
    parseHudPreferences(JSON.stringify(prefs)).input.gamepad.slot1,
    7,
  );
  prefs.input.keys.driveUp = "Space";
  assert.equal(
    parseHudPreferences(JSON.stringify(prefs)).input.keys.driveUp,
    "KeyW",
  );
});
test("catalog searches names and categories and filters favorites by stable ID", () => {
  assert.equal(libraryItem("sound:42")?.name, "Alarm 1");
  assert.equal(libraryItem("animation:55")?.name, "Additional motor sound");
  assert.deepEqual(
    searchLibrary({
      kind: "sounds",
      category: "Sad",
      query: "sad 10",
      favorites: [],
      favoritesOnly: false,
    }).map((x) => x.key),
    ["sound:208"],
  );
  assert.deepEqual(
    searchLibrary({
      kind: "all",
      category: "All",
      query: "",
      favorites: ["animation:13"],
      favoritesOnly: true,
    }).map((x) => x.key),
    ["animation:13"],
  );
  assert.equal(libraryItems.filter((x) => x.kind === "sound").length, 212);
});
test("RGB changes only PSI channels, fixed emitters retain independent brightness", () => {
  assert.deepEqual(
    colorToChannels([1, 2, 3, 4, 5, 6, 70, 80], "rear", "#123456"),
    [1, 2, 3, 18, 52, 86, 70, 80],
  );
  const cmd = selectedLightCommand(
    [10, 20, 30, 40, 50, 60, 70, 80],
    [false, false, false, false, false, false, true, true],
  );
  assert.deepEqual([...cmd.data], [0, 136, 70, 80]);
  assert.throws(() =>
    selectedLightCommand([999, 0, 0, 0, 0, 0, 0, 0], Array(8).fill(true)),
  );
  assert.deepEqual(lightPreset("Off"), [0, 0, 0, 0, 0, 0, 0, 0]);
});

test("duplicate gamepad assignments and repurposed physical Start are rejected", () => {
  const p = defaultsHudPreferences();
  p.input.gamepad.slot2 = 9;
  assert.throws(() => validateHudPreferences(p), /button|Start/);
});

// Channel mask: front 1/2/4, readouts 8, rear 16/32/64, projector 128.
test("LED payload uses APK mask order rather than visual group order", () => {
 const values=[10,20,30,40,50,60,70,80];
 assert.deepEqual([...selectedLightCommand(values,Array(8).fill(true)).data], [0,255,10,20,30,70,40,50,60,80]);
 assert.deepEqual([...selectedLightCommand(values,[false,false,false,true,true,true,false,false]).data], [0,112,40,50,60]);
 assert.deepEqual([...selectedLightCommand(values,[false,false,false,false,false,false,true,false]).data], [0,8,70]);
});


test("eight-slot preferences migrate without losing custom slots, gear or mappings", () => {
 const old:any=defaultsHudPreferences();old.soundboard=old.soundboard.slice(0,8);old.soundboard[0]="sound:42";
 old.gear=2;old.input.keys.driveUp="KeyI";delete old.input.keys.slot9;delete old.input.gamepad.slot9;
 const migrated=parseHudPreferences(JSON.stringify(old));
 assert.deepEqual(migrated.soundboard.slice(0,8),old.soundboard);
 assert.equal(migrated.soundboard.length,9);assert.equal(migrated.gear,2);
 assert.equal(migrated.input.keys.driveUp,"KeyI");assert.equal(migrated.input.keys.slot9,"Digit9");
 assert.equal(migrated.input.gamepad.slot9,-1);
 const pinned=pinSoundboard(migrated,8,"sound:42");
 assert.equal(parseHudPreferences(JSON.stringify(pinned)).soundboard[8],"sound:42");
});


test("adding slot nine preserves a pre-existing Digit9 assignment",()=>{
 const old:any=defaultsHudPreferences();old.soundboard=old.soundboard.slice(0,8);
 delete old.input.keys.slot9;delete old.input.gamepad.slot9;old.input.keys.driveUp='Digit9';
 const migrated=parseHudPreferences(JSON.stringify(old));
 assert.equal(migrated.input.keys.driveUp,'Digit9');assert.equal(migrated.input.keys.slot9,'Digit0');
});
