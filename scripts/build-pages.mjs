import {mkdir,copyFile,writeFile,readFile,rm} from 'node:fs/promises';
import {publicFeed} from './public-feed.mjs';
const target=new URL('../dist/',import.meta.url),web=new URL('../web/',import.meta.url);
await rm(target,{recursive:true,force:true});await mkdir(new URL('web/public/',target),{recursive:true});
// Only these assets enter Pages; historical personal reference files are excluded.
for(const name of ['index.html','conferences.html','jobs.js','jobs.css','core.js','conference-data.js'])await copyFile(new URL(name,web),new URL('web/'+name,target));
await copyFile(new URL('../index.html',import.meta.url),new URL('index.html',target));
await writeFile(new URL('.nojekyll',target),'');
await writeFile(new URL('web/reference-data.js',target),'window.RADAR_SEED={references:[],resources:[],links:[]};\n');
await writeFile(new URL('web/public/feed.json',target),JSON.stringify(publicFeed(JSON.parse(await readFile(new URL('public/feed.json',web),'utf8'))),null,2));
await copyFile(new URL('public/sources.json',web),new URL('web/public/sources.json',target));
