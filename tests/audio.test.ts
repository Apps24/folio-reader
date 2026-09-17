import {test} from 'node:test';
import assert from 'node:assert/strict';
import {joinPassages,normalizeSpeechText,speechChunks} from '../src/audio.ts';

test('speech normalization expands common titles and abbreviations',()=>{
 assert.equal(
  normalizeSpeechText('Mr. Holmes met Mrs. Hudson, Ms. Adler, Dr. Watson and Prof. Moriarty vs. one another.'),
  'Mister Holmes met Missus Hudson, Miss Adler, Doctor Watson and Professor Moriarty versus one another.'
 );
 assert.equal(normalizeSpeechText('Use it, e.g. today; i.e. do not wait, etc.'),'Use it, for example today; that is do not wait, et cetera');
});

test('joined narration passages retain every highlighted EPUB block',()=>{
 const units=joinPassages([
  {text:speechChunks('First paragraph.')[0],blockIndexes:[0],paragraphEnd:true},
  {text:speechChunks('Second paragraph.')[0],blockIndexes:[1],paragraphEnd:true},
 ]);
 assert.equal(units.length,1);
 assert.deepEqual(units[0].blockIndexes,[0,1]);
});
