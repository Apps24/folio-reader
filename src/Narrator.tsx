import {authenticatedFetch} from './supabase';
import {useEffect,useMemo,useRef,useState} from 'react';
import {AudioBufferQueue,joinPassages,normalizeSpeechText,speechChunks,audioError} from './audio';

export type NarrationSettings={mode:'browser'|'ai';speaker:string;speed:number;browserVoice:string};
type Props={
 blocks:string[];paid:boolean;settings:NarrationSettings;fullBook:boolean;autoStart:boolean;
 onSettingsChange:(settings:NarrationSettings)=>void;onFullBookChange:(enabled:boolean)=>void;
 onActiveBlocks:(indexes:number[])=>void;onFinished:(continueBook:boolean)=>void;onAutoStartHandled:()=>void;
};
const aiVoices=[['athena','Athena'],['pluto','Pluto'],['orpheus','Orpheus'],['pandora','Pandora'],['vesta','Vesta'],['minerva','Minerva'],['zeus','Zeus'],['orion','Orion']];

export default function Narrator({blocks,paid,settings,fullBook,autoStart,onSettingsChange,onFullBookChange,onActiveBlocks,onFinished,onAutoStartHandled}:Props){
 const {mode,speaker,speed,browserVoice}=settings;
 const [status,setStatus]=useState('idle'),[position,setPosition]=useState(0),[error,setError]=useState(''),[voices,setVoices]=useState<SpeechSynthesisVoice[]>([]);
 const queue=useRef<AudioBufferQueue|null>(null),player=useRef<HTMLAudioElement|null>(null),url=useRef<string|null>(null),generation=useRef(0),continueBook=useRef(fullBook);
 const units=useMemo(()=>joinPassages(blocks.flatMap((value,blockIndex)=>speechChunks(normalizeSpeechText(value)).map(text=>({text,blockIndexes:[blockIndex],paragraphEnd:true})))),[blocks]);
 function change(patch:Partial<NarrationSettings>){onSettingsChange({...settings,...patch})}
 function stop(){generation.current++;queue.current?.stop();queue.current=null;player.current?.pause();player.current=null;window.speechSynthesis?.cancel();if(url.current)URL.revokeObjectURL(url.current);url.current=null;setStatus('idle');onActiveBlocks([])}
 function finish(){setStatus('idle');onActiveBlocks([]);onFinished(continueBook.current)}
 function activate(i:number){setPosition(i);onActiveBlocks(units[i]?.blockIndexes||[])}
 useEffect(()=>{continueBook.current=fullBook},[fullBook]);
 useEffect(()=>{const synth=window.speechSynthesis;if(!synth)return;const load=()=>setVoices(synth.getVoices().filter(voice=>voice.lang.toLowerCase().startsWith('en')));load();synth.addEventListener?.('voiceschanged',load);return()=>synth.removeEventListener?.('voiceschanged',load)},[]);
 useEffect(()=>{stop();setPosition(0);return stop},[units]);
 useEffect(()=>{if(autoStart&&units.length){onAutoStartHandled();continueBook.current=true;void start(0)}},[autoStart,units]);
 async function start(at=position){stop();setError('');const token=++generation.current;if(!units[at])return;
  if(mode==='browser'){
   if(!window.speechSynthesis){setError('Device narration is unavailable in this browser.');return}
   const play=(i:number)=>{if(token!==generation.current)return;if(!units[i]){finish();return}activate(i);const speech=new SpeechSynthesisUtterance(units[i].text);speech.rate=speed;speech.lang='en';speech.voice=voices.find(voice=>voice.voiceURI===browserVoice)||voices.find(voice=>/natural|neural|online/i.test(voice.name))||voices[0]||null;speech.onstart=()=>setStatus('playing');speech.onend=()=>play(i+1);speech.onerror=event=>{if(event.error!=='canceled'){setStatus('idle');setError('Device narration stopped unexpectedly.')}};window.speechSynthesis.speak(speech)};play(at);return;
  }
  const buffer=new AudioBufferQueue(async(i,signal)=>{const response=await authenticatedFetch('/api/tts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:units[i].text,speaker}),signal:AbortSignal.any([signal,AbortSignal.timeout(45000)])});if(!response.ok){const data=await response.json() as {error?:string};throw new Error(data.error||`Voice failed (${response.status})`)}if(!response.headers.get('content-type')?.startsWith('audio/'))throw new Error('Invalid voice response');return response.blob()},units.length);queue.current=buffer;const audio=new Audio();player.current=audio;
  const fail=(cause:unknown)=>{if(token===generation.current){stop();setError(audioError(cause))}};
  const play=async(i:number):Promise<void>=>{if(token!==generation.current)return;if(!units[i]){finish();return}setStatus('loading');activate(i);const blob=await buffer.take(i);if(token!==generation.current)return;url.current=URL.createObjectURL(blob);audio.src=url.current;audio.playbackRate=speed;audio.onplaying=()=>setStatus('playing');audio.onended=()=>{if(url.current)URL.revokeObjectURL(url.current);url.current=null;void play(i+1).catch(fail)};audio.onerror=()=>fail(new Error('Audio could not be decoded.'));await audio.play()};void play(at).catch(fail);
 }
 function toggle(){if(status==='playing'){mode==='ai'?player.current?.pause():window.speechSynthesis.pause();setStatus('paused')}else if(status==='paused'){if(mode==='ai')void player.current?.play().catch(cause=>{setError(audioError(cause));setStatus('idle')});else window.speechSynthesis.resume();setStatus('playing')}else{continueBook.current=false;onFullBookChange(false);void start()}}
 function readFull(){continueBook.current=true;onFullBookChange(true);if(status==='paused')toggle();else if(status==='idle')void start()}
 function stopAll(){continueBook.current=false;onFullBookChange(false);stop()}
 return <section className="narrator" aria-label="Narration"><div className="row"><span className="sound">◖))</span><strong>Listen to this book</strong><span className="muted">Passage {Math.min(position+1,units.length)} / {units.length}</span>{fullBook&&<span className="fullReadBadge">FULL BOOK</span>}</div><div className="row wrap"><button onClick={toggle} disabled={!units.length||status==='loading'}>{status==='playing'?'Pause':status==='paused'?'Resume':status==='loading'?'Preparing audio…':'▶ Listen'}</button><button onClick={readFull} disabled={!units.length||status==='loading'}>{fullBook?'✓ Full-book mode':'▶ Read full book'}</button><button className="ghost" onClick={stopAll}>Stop</button><label>Voice mode<select value={mode} onChange={event=>{stopAll();change({mode:event.target.value as 'browser'|'ai'})}}><option value="browser">Device voice · Free</option><option value="ai" disabled={!paid}>Aura-2 · Paid</option></select></label>{mode==='browser'&&<label>Voice<select value={browserVoice} onChange={event=>{stop();change({browserVoice:event.target.value})}}><option value="">Automatic natural voice</option>{voices.map(voice=><option key={voice.voiceURI} value={voice.voiceURI}>{voice.name} · {voice.lang}</option>)}</select></label>}{mode==='ai'&&<label>AI voice<select value={speaker} onChange={event=>{stop();change({speaker:event.target.value})}}>{aiVoices.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>}<label>Speed<select value={speed} onChange={event=>{stop();change({speed:Number(event.target.value)})}}>{[.8,1,1.15,1.3,1.5].map(value=><option key={value} value={value}>{value}×</option>)}</select></label></div>{mode==='ai'&&<small>The current and next passage are sent to Cloudflare for narration and count toward your allowance.</small>}{fullBook&&<small>Full-book mode continues automatically through every remaining chapter.</small>}{error&&<p role="alert" className="error">{error}</p>}</section>
}
