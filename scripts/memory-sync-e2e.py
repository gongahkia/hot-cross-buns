#!/usr/bin/env python3
"""Exercise two isolated HCB profiles over two real Syncthing daemons.

No user profile or existing Syncthing configuration is opened. All listeners
bind loopback; discovery, relays, upgrades and telemetry are disabled.
"""
import json,os,sys,time,tempfile,pathlib,subprocess,socket,urllib.request,xml.etree.ElementTree as ET,signal,shutil
import argparse
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--syncthing',required=True,type=pathlib.Path)
parser.add_argument('--runtime',type=pathlib.Path)
parser.add_argument('--output',type=pathlib.Path)
args=parser.parse_args()
root=pathlib.Path(__file__).resolve().parent.parent
artifacts=args.output.resolve() if args.output else root/'.hot-cross-buns/local-dev'
artifacts.mkdir(parents=True,exist_ok=True)
base=pathlib.Path(tempfile.mkdtemp(prefix='sync-e2e-',dir=artifacts)).resolve();os.chmod(base,0o700)
binary=args.syncthing.resolve();runtime=(args.runtime or root/'runtime/hot-cross-buns-runtime').resolve()
def port():
 with socket.socket() as s:s.bind(('127.0.0.1',0));return s.getsockname()[1]
def wait_for(check,timeout=35):
 until=time.monotonic()+timeout
 while time.monotonic()<until:
  try:
   value=check()
   if value:return value
  except (OSError,ValueError,urllib.error.HTTPError):pass
  except RuntimeError as error:
   if 'already running' not in str(error):raise
  time.sleep(.2)
 raise RuntimeError('Timed out waiting for '+getattr(check,'__name__','condition'))
profiles=[];processes=[];supervisors=[]
def api(p,path,method='GET',data=None):
 request=urllib.request.Request(p['endpoint']+path,method=method,headers={'X-API-Key':p['key'],'Content-Type':'application/json'},data=json.dumps(data).encode() if data is not None else None)
 with urllib.request.urlopen(request,timeout=5) as response:
  body=response.read();return json.loads(body) if body else {}
def start(p):
 log=open(p['home']/'syncthing.log','ab');child=subprocess.Popen([str(binary),'serve','--home',str(p['home']),'--no-browser','--no-restart','--no-upgrade'],stdout=log,stderr=log);log.close();processes.append(child);p['process']=child
 wait_for(lambda:api(p,'/rest/system/status'))
def stop(p):
 child=p.get('process')
 if child and child.poll() is None:child.terminate();child.wait(timeout=10)
def cli(p,args,input=None):
 env=dict(os.environ,HOT_CROSS_BUNS_INTERNAL_COMMANDS='1',HOT_CROSS_BUNS_STATE_DIR=str(p['state']),HOT_CROSS_BUNS_CONFIG_DIR=str(p['config']))
 result=subprocess.run([str(runtime)]+args,input=json.dumps(input) if input is not None else None,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env=env,timeout=35)
 if result.returncode:raise RuntimeError('HCB operation failed: '+result.stderr)
 return result.stdout

def start_supervisor(p):
 env=dict(os.environ,HOT_CROSS_BUNS_INTERNAL_COMMANDS='1',HOT_CROSS_BUNS_STATE_DIR=str(p['state']),HOT_CROSS_BUNS_CONFIG_DIR=str(p['config']))
 with open(p['home']/'supervisor.log','ab') as log:
  child=subprocess.Popen([str(runtime),'job','supervisor'],env=env,stdout=log,stderr=log)
 supervisors.append(child)
def sync(p):return wait_for(lambda:json.loads(cli(p,['memory','sync','request'],{'action':'run'})))
try:
 for name in ['a','b']:
  home=base/name;home.mkdir();subprocess.run([str(binary),'generate','--home',str(home),'--no-port-probing'],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
  tree=ET.parse(home/'config.xml');cfg=tree.getroot();folder=base/(name+'-shared');folder.mkdir();state=base/(name+'-state');state.mkdir();config=base/(name+'-config');config.mkdir()
  profiles.append({'name':name,'home':home,'tree':tree,'xml':cfg,'folder':folder,'state':state,'config':config,'key':cfg.findtext('gui/apikey'),'id':cfg.find('device').attrib['id'],'apiport':port(),'listenport':port()})
 for p,other in [(profiles[0],profiles[1]),(profiles[1],profiles[0])]:
  cfg=p['xml'];cfg.find('gui/address').text='127.0.0.1:'+str(p['apiport']);p['endpoint']='http://127.0.0.1:'+str(p['apiport'])
  options=cfg.find('options')
  for name,value in {'globalAnnEnabled':'false','localAnnEnabled':'false','relaysEnabled':'false','natEnabled':'false','startBrowser':'false','urAccepted':'-1','crashReportingEnabled':'false','autoUpgradeIntervalH':'0'}.items():
   node=options.find(name)
   if node is None:node=ET.SubElement(options,name)
   node.text=value
  for node in options.findall('listenAddress'):options.remove(node)
  ET.SubElement(options,'listenAddress').text='tcp://127.0.0.1:'+str(p['listenport'])
  for node in cfg.findall('folder'):cfg.remove(node)
  f=ET.SubElement(cfg,'folder',{'id':'hcb-memory','label':'HCB integration fixture','path':str(p['folder']),'type':'sendreceive','rescanIntervalS':'1','fsWatcherEnabled':'true','fsWatcherDelayS':'0.1'})
  for device in [p,other]:ET.SubElement(f,'device',{'id':device['id']})
  peer=ET.SubElement(cfg,'device',{'id':other['id'],'name':'HCB fixture '+other['name'],'compression':'metadata'});ET.SubElement(peer,'address').text='tcp://127.0.0.1:'+str(other['listenport'])
  p['tree'].write(p['home']/'config.xml',encoding='utf-8',xml_declaration=True)
  start(p)
 a,b=profiles
 for p in profiles:
  status=json.loads(cli(p,['memory','sync','status']))
  cli(p,['memory','sync','request'],{'action':'configure','revision':status['revision'],'endpoint':p['endpoint'],'folder_id':'hcb-memory','api_key':p['key']})
 wait_for(lambda:api(a,'/rest/system/connections').get('connections',{}).get(b['id'],{}).get('connected'))
 cli(a,['memory','add','--kind','preference','I prefer a casual and concise response style.'])
 for p in profiles:start_supervisor(p)
 print('Started automatic sync for both isolated profiles.',flush=True)
 first=wait_for(lambda:json.loads(cli(a,['memory','sync','status'])) if list((a['folder']/'hcb-memory-profile'/'changes').glob('*.md')) else None)
 packet=lambda: list((b['folder']/'hcb-memory-profile'/'changes').glob('*.md')) if (b['folder']/'hcb-memory-profile'/'changes').exists() else []
 wait_for(packet)
 wait_for(lambda:'casual and concise' in cli(b,['memory','list']))
 received=json.loads(cli(b,['memory','sync','status']))
 print('Automatic import and recall on the second profile passed.',flush=True)
 assert 'casual and concise' in cli(b,['memory','list']),'memory did not import on the second device'
 wait_for(lambda:list((a['folder']/'hcb-memory-profile'/'receipts').glob('*.json')) and len(list((a['folder']/'hcb-memory-profile'/'receipts').glob('*.json')))>=2)
 def imported_receipt():
  report=sync(a)
  return report if report['report']['imported_devices']>=1 else None
 confirmation=wait_for(imported_receipt)
 stop(b)
 cli(a,['memory','add','--kind','fact','My current personal project is a bakery assistant.'])
 offline=sync(a)
 assert 'waiting' in offline['report']['delivery'].lower(),'offline peer falsely reported delivered'
 start(b)
 wait_for(lambda: len(packet())>=2)
 # Wait for the actual newly published packet, not merely an old file count.
 wait_for(lambda:any('bakery assistant' in p.read_text() for p in packet()))
 wait_for(lambda:'bakery assistant' in cli(b,['memory','list']))
 after=json.loads(cli(b,['memory','sync','status']))
 assert 'bakery assistant' in cli(b,['memory','list']),'offline update was not imported after reconnection'
 outcome={'syncthing':subprocess.check_output([str(binary),'--version'],text=True).splitlines()[0],'profiles':2,'imported_preference':True,'import_receipt_confirmed':True,'offline_delivery_reported_pending':True,'offline_catch_up_imported':True,'automatic_import_verified':True,'fixture_directory':str(base),'first_publish':first['report']['published'],'first_import':received['report']['imported']}
 (artifacts/'memory-sync-e2e-result.json').write_text(json.dumps(outcome,indent=2));print(json.dumps(outcome))
finally:
 for child in supervisors:
  if child.poll() is None:child.terminate();child.wait(timeout=15)
 for p in profiles:stop(p)
