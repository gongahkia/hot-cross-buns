export const manifest = (() => {
function __memo(fn) {
	let value;
	return () => value ??= (value = fn());
}

return {
	appDir: "_app",
	appPath: "_app",
	assets: new Set(["favicon.png","svelte.svg","tauri.svg","vite.svg"]),
	mimeTypes: {".png":"image/png",".svg":"image/svg+xml"},
	_: {
		client: {start:"_app/immutable/entry/start.C7nHLtpz.js",app:"_app/immutable/entry/app.BdaI3Anm.js",imports:["_app/immutable/entry/start.C7nHLtpz.js","_app/immutable/chunks/Do_BxIq_.js","_app/immutable/chunks/5dEc8SCr.js","_app/immutable/entry/app.BdaI3Anm.js","_app/immutable/chunks/D1UZXQzr.js","_app/immutable/chunks/5dEc8SCr.js","_app/immutable/chunks/N7vJ_rYB.js","_app/immutable/chunks/A5upEvm6.js","_app/immutable/chunks/DwfApId-.js"],stylesheets:[],fonts:[],uses_env_dynamic_public:false},
		nodes: [
			__memo(() => import('./nodes/0.js')),
			__memo(() => import('./nodes/1.js')),
			__memo(() => import('./nodes/2.js'))
		],
		remotes: {
			
		},
		routes: [
			{
				id: "/",
				pattern: /^\/$/,
				params: [],
				page: { layouts: [0,], errors: [1,], leaf: 2 },
				endpoint: null
			}
		],
		prerendered_routes: new Set([]),
		matchers: async () => {
			
			return {  };
		},
		server_assets: {}
	}
}
})();
