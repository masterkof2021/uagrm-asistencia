// Servidor de archivos del cliente: solo Node.js, sin servicios ni base de datos.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

export function createFrontendServer({backendUrl='http://127.0.0.1:3000'}={}) {
 const backend=new URL(backendUrl);
 if(!['http:','https:'].includes(backend.protocol) || backend.username || backend.password || backend.search || backend.hash || backend.pathname!=='/')throw new Error('API_BASE_URL debe ser una URL http(s) del backend, sin ruta ni credenciales.');
 const files=new Map([
  ['/', ['index.html','text/html; charset=utf-8']],
  ['/index.html',['index.html','text/html; charset=utf-8']],
  ['/app.js',['app.js','text/javascript; charset=utf-8']],
  ['/styles.css',['styles.css','text/css; charset=utf-8']]
 ]);
 return createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Security-Policy',`default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' ${backend.origin}; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`);
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{'Allow':'GET, HEAD'});return res.end();}
  const pathname=new URL(req.url,'http://frontend.local').pathname;
  if(pathname==='/config.js') {
   res.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'no-store'});
   return res.end(req.method==='HEAD'?undefined:`window.APP_CONFIG = Object.freeze({apiBaseUrl: ${JSON.stringify(backend.origin+'/api')}});\n`);
  }
  const file=files.get(pathname);
  if(!file){res.writeHead(404);return res.end('No encontrado.');}
  try{const data=await readFile(new URL('../public/'+file[0],import.meta.url));res.writeHead(200,{'Content-Type':file[1],'Cache-Control':'no-cache'});res.end(req.method==='HEAD'?undefined:data);}
  catch{res.writeHead(500);res.end('No se pudo cargar la interfaz.');}
 });
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const host=process.env.FRONTEND_HOST||'0.0.0.0',port=Number(process.env.FRONTEND_PORT||8080);
 const server=createFrontendServer({backendUrl:process.env.API_BASE_URL||'http://127.0.0.1:3000'});
 server.listen(port,host,()=>console.log(`Cliente: http://localhost:${port} · Backend: ${process.env.API_BASE_URL||'http://127.0.0.1:3000'}`));
 process.on('SIGINT',()=>server.close(()=>process.exit(0)));
}
