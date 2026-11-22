"""Headless verification; pinned to the packaged candidate's Go runtime."""
import hashlib,json,os,pathlib,subprocess,time,datetime
root=pathlib.Path('macos/presence/evidence/p04e-1r')
runtime='/tmp/HotCrossBuns-Native-P04E1R-Verified.app/Contents/Resources/hot-cross-buns-runtime'
env=os.environ|{'HOT_CROSS_BUNS_TEST_BINARY':runtime}
commands=[('swift-build',['swift','build','--package-path','macos','--scratch-path','/tmp/hot-cross-buns-native-build']),('swift-full',['swift','test','--package-path','macos','--scratch-path','/tmp/hot-cross-buns-native-build','--no-parallel']),('swift-strict',['swift','test','--package-path','macos','--scratch-path','/tmp/hot-cross-buns-native-build','--no-parallel','-Xswiftc','-strict-concurrency=complete','-Xswiftc','-warnings-as-errors','--filter','mascot|presence|desktopPet|desktopPresence|realGoPresentationNavigationAndShutdownDoNotDecidePendingApproval|approvalGuardsExactIdentity'])]
results=[]
for name,command in commands:
    start=time.monotonic();utc=datetime.datetime.now(datetime.timezone.utc).isoformat()
    with (root/f'{name}.log').open('w') as out:result=subprocess.run(command,env=env,stdout=out,stderr=subprocess.STDOUT)
    results.append({'name':name,'command':command,'startedUTC':utc,'seconds':time.monotonic()-start,'exit':result.returncode,'HOT_CROSS_BUNS_TEST_BINARY':runtime,'runtimeSHA256':hashlib.sha256(pathlib.Path(runtime).read_bytes()).hexdigest()})
    (root/'verification.json').write_text(json.dumps(results,indent=2)+'\n');print(json.dumps(results[-1]),flush=True)
    if result.returncode:raise SystemExit(result.returncode)
