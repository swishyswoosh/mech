import {test} from 'node:test';
import assert from 'node:assert/strict';
import {paletteFor, inputTheme} from '../../../app/theme/appearance.ts';
import {darkPalette, lightPalette} from '../../../app/theme/palettes.ts';
test('native appearance resolves semantic colors independently in both themes',()=>{
 assert.equal(paletteFor('dark'),darkPalette);
 assert.equal(paletteFor('light'),lightPalette);
 assert.equal(darkPalette.primary,darkPalette.danger);
 assert.notEqual(paletteFor('light').primary,paletteFor('light').danger);
 assert.notEqual(paletteFor('light').bg,paletteFor('light').onPrimary);
});
test('native fields use the selected surface, text, caret and selection together',()=>{
 for(const mode of ['dark','light'] as const){const colors=paletteFor(mode),{inputPalette,inputSurface}=inputTheme(colors);
 assert.equal(inputSurface.backgroundColor,colors.bg);assert.equal(inputSurface.color,colors.text);
 assert.equal(inputPalette.caret,colors.primary);assert.equal(inputPalette.selection,colors.selection);
 assert.equal(inputPalette.placeholder,colors.textMuted);
 }
});
