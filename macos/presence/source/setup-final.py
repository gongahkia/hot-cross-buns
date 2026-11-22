# disposable profile, exact packaged binaries; changes only test preference domain
import pathlib,subprocess,tempfile,os,json,hashlib,uuid,time,plistlib,shutil,sys
candidate=pathlib.Path(sys.argv[1]);assert candidate.is_dir()
root=pathlib.Path(tempfile.mkdtemp(prefix='hot-cross-buns-native-test-presence-',dir='/tmp'));root.chmod(0o700)
helper=root/'seed';subprocess.run(['go','build','-o',str(helper),'macos/Tests/HotCrossBunsCoreTests/Fixtures/native-catalog-seed.go'],check=True)
ids=json.loads(subprocess.check_output([str(helper),str(root),'3']))
node=shutil.which('node'); assert node
provider=subprocess.Popen([node,'macos/mascot/2d/acceptance/provider.mjs'],env={'PATH':os.environ['PATH'],'HOT_CROSS_BUNS_FIXTURE_CONTROL':str(root)},stdout=subprocess.PIPE,stderr=open(root/'provider.log','w'))
port=json.loads(provider.stdout.readline())['port']
config=root/'config/hot-cross-buns';config.mkdir(parents=True,mode=0o700)
p=config/'config.json';p.write_text(json.dumps({'version':4,'defaults':{'provider':'openai','model':'gpt-5.6'},'provider_endpoints':{'openai':f'http://127.0.0.1:{port}/responses'}}));p.chmod(0o600)
bundle='dev.hot-cross-buns.presence.finalcheck';app=root/'PresenceCheck.app';shutil.copytree(candidate,app)
p=app/'Contents/Info.plist';info=plistlib.loads(p.read_bytes());info['CFBundleIdentifier']=bundle;info['CFBundleName']='PresenceCheck';info['CFBundleDisplayName']='PresenceCheck';p.write_bytes(plistlib.dumps(info))
for k,v in [('hot-cross-buns.notch.enabled','false'),('hot-cross-buns.menuBar.enabled','true'),('hot-cross-buns.mascot.shown','true'),('hot-cross-buns.mascot.animated','true')]:subprocess.run(['defaults','write',bundle,k,'-bool',v],check=True)
subprocess.run(['defaults','write',bundle,'hot-cross-buns.presence.mode','-string','reactions'],check=True)
archive=root/'native/native/drafts';archive.mkdir(parents=True,mode=0o700)
f=archive/(hashlib.sha256(str(root/'state').encode()).hexdigest()+'.json');f.write_text(json.dumps({'version':1,'selectedConversationID':ids[-1],'drafts':{'conversation:'+ids[-1]:{'text':'Presence acceptance — preserve this unsent draft','revision':str(uuid.uuid4()),'updated':time.time()-978307200}}}));f.chmod(0o600)
wrapper=root/'runtime';wrapper.write_text('#!/usr/bin/env python3\n'+pathlib.Path('macos/Tests/HotCrossBunsCoreTests/Fixtures/dev-acceptance-runtime.py').read_text());wrapper.chmod(0o700)
env={'PATH':os.path.dirname(node)+':'+os.environ['PATH'],'HOME':str(root),'HOT_CROSS_BUNS_NATIVE_USER_DATA':str(root/'native'),'HOT_CROSS_BUNS_NATIVE_WORKSPACE':str(root/'workspace'),'HOT_CROSS_BUNS_CONFIG_DIR':str(root/'config'),'HOT_CROSS_BUNS_STATE_DIR':str(root/'state'),'OPENAI_API_KEY':'fixture-only-inert-mascot','HOT_CROSS_BUNS_NATIVE_RUNTIME':str(wrapper),'HOT_CROSS_BUNS_FIXTURE_CONTROL':str(root),'HOT_CROSS_BUNS_FIXTURE_GO_RUNTIME':str(app/'Contents/Resources/hot-cross-buns-runtime'),'GIT_CONFIG_NOSYSTEM':'1','GIT_CONFIG_GLOBAL':'/dev/null'}
hashes={str(x.relative_to(candidate)):hashlib.sha256(x.read_bytes()).hexdigest() for x in candidate.rglob('*') if x.is_file()}
for file,digest in hashes.items():
 if file!='Contents/Info.plist':assert hashlib.sha256((app/file).read_bytes()).hexdigest()==digest
m={'candidate':str(candidate),'app':str(app),'root':str(root),'ids':ids,'bundle':bundle,'env':env,'providerPID':provider.pid,'hashes':hashes}
pathlib.Path('/tmp/hot-cross-buns-presence-final-session.json').write_text(json.dumps(m,indent=2));print(json.dumps({'root':str(root),'providerPID':provider.pid,'port':port,'bundle':bundle}))
