// This bootstrap runs only in an opaque, script-enabled sandbox.
window.addEventListener("message", event => {
  if (event.source !== parent || event.origin !== new URL(document.URL).origin || event.data?.type !== "render-artifact") return;
  if (typeof event.data.source !== "string") return;
  const theme = `<style>
    :root{color:#37352f;background:#fff;font:15px/1.6 system-ui,sans-serif;--text:#37352f;--muted:#787774;--line:#eeedeb;--wash:#f7f7f5;--accent:#888f7b}
    body{margin:20px}*{box-sizing:border-box}svg,img{max-width:100%;height:auto}svg{color:var(--accent);fill:currentColor}
    button,input,select,textarea{font:inherit;color:inherit}button,select,input,textarea{border:1px solid var(--line);border-radius:4px;padding:6px 10px;background:var(--wash)}button{cursor:pointer}button:hover{background:#eeedeb}a{color:inherit}
  </style>`;
  const resize = `<script>
    new ResizeObserver(() => parent.postMessage({type:'artifact-size',height:Math.max(80,document.body.scrollHeight+40)},'*')).observe(document.documentElement);
  <\/script>`;
  // A header CSP remains in force for the replacement document and its generated scripts.
  const source = event.data.source;
  const parsed = new DOMParser().parseFromString(source, "text/html");
  parsed.head.insertAdjacentHTML("afterbegin", '<meta charset="utf-8">' + theme);
  parsed.body.insertAdjacentHTML("beforeend", resize);
  document.open();
  document.write("<!doctype html>" + parsed.documentElement.outerHTML);
  document.close();
}, { once: true });
