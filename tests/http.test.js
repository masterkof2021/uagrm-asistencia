import test from 'node:test';
import {createServer} from 'node:http';
import assert from 'node:assert/strict';
import {createApp} from '../src/presentation/app.js';
import {createFrontendServer} from '../frontend/server.js';
async function listen(server,t){await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});t.after(()=>new Promise(resolve=>server.close(resolve)));return `http://127.0.0.1:${server.address().port}`;}
test('API remota: CORS, Bearer, sesión, descargas y rechazo de origen',async t=>{
 const service={login:async()=>({id:10,role:'student',name:'Ana'}),dashboard:async user=>({students:[{id:user.id}]}),correct:async()=>{throw Object.assign(new Error('Solo administrador'),{code:'FORBIDDEN'});},template:async()=>Buffer.from('excel-template'),export:async()=>Buffer.from('excel-report')};
 const origin='http://192.168.1.20:8080';
 const url=await listen(createServer(createApp(service,{allowedOrigins:[origin]})),t);
 assert.equal((await fetch(url+'/')).status,404); // Backend no sirve la interfaz.
 assert.equal((await fetch(url+'/api/dashboard')).status,401);
 const preflight=await fetch(url+'/api/attendance',{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':'PUT','Access-Control-Request-Headers':'authorization,content-type'}});
 assert.equal(preflight.status,204);assert.equal(preflight.headers.get('access-control-allow-origin'),origin);assert.match(preflight.headers.get('access-control-allow-headers'),/Authorization/);
 assert.equal((await fetch(url+'/api/login',{method:'POST',headers:{Origin:'http://otro-equipo:8080','Content-Type':'application/json'},body:'{}'})).status,403);
 const login=await fetch(url+'/api/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'{}'});assert.equal(login.status,200);assert.equal(login.headers.get('set-cookie'),null);
 const {token}=await login.json();assert.match(token,/^[a-f0-9]{64}$/);
 const headers={Origin:origin,Authorization:`Bearer ${token}`};
 const response=await fetch(url+'/api/dashboard',{headers});assert.deepEqual(await response.json(),{students:[{id:10}]});
 assert.equal((await fetch(url+'/api/dashboard',{headers:{Origin:origin,Authorization:'Bearer incorrecto'}})).status,401);
 const correction=await fetch(url+'/api/attendance',{method:'PUT',headers:{...headers,'Content-Type':'application/json'},body:'{}'});assert.equal(correction.status,403);
 for(const [path,text] of [['/template/students','excel-template'],['/export','excel-report']]){const download=await fetch(url+'/api'+path,{headers});assert.equal(download.status,200);assert.match(download.headers.get('content-type'),/spreadsheetml/);assert.equal(await download.text(),text);}
 await fetch(url+'/api/logout',{method:'POST',headers});assert.equal((await fetch(url+'/api/dashboard',{headers})).status,401);
});
test('Cliente arranca solo y expone únicamente archivos y configuración pública',async t=>{
 const url=await listen(createFrontendServer({backendUrl:'http://192.168.1.30:3000'}),t);
 const page=await fetch(url+'/');assert.equal(page.status,200);assert.match(await page.text(),/config.js/);
 assert.match(page.headers.get('content-security-policy'),/connect-src 'self' http:\/\/192.168.1.30:3000/);
 const config=await fetch(url+'/config.js');assert.match(await config.text(),/http:\/\/192.168.1.30:3000\/api/);assert.equal(config.headers.get('cache-control'),'no-store');
 assert.equal((await fetch(url+'/api/login',{method:'POST'})).status,405);
 for(const path of ['/api/dashboard','/.env.backend','/src/server.js','/database/schema.sql'])assert.equal((await fetch(url+path)).status,404);
 assert.equal((await fetch(url+'/app.js')).status,200);
 assert.throws(()=>createFrontendServer({backendUrl:'file:///tmp/test'}));
});
