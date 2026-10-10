#!/usr/bin/env python3
"""Local, isolated visual review for Artes public photo candidates.

No moderation dataset, source code, production service or existing review is edited.
Requires the downloader's unreviewed-images.jsonl and image files.
"""
import argparse
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, unquote

ROOT = Path.cwd() if __file__ == "<stdin>" else Path(__file__).resolve().parents[1]
DEFAULT_FOLDER = ROOT / ".tmp/moderation-research-discovery/public-photo-candidates-20261010"
NUDITY = ["", "none", "underwear_swimwear", "implied_nude", "bare_buttocks", "female_bare_breasts", "genitalia", "male_topless"]
SEXUAL = ["", "none", "suggestive", "bdsm_kink", "explicit_act"]
AGE = ["", "adult_clear", "skip_minor_or_age_uncertain", "not_required_nonadult_nonsexual"]
STATUS = ["unreviewed", "reviewed", "excluded"]
HTML = r"""<!doctype html><html lang="nl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Artes - Beeldbeoordeling</title>
<style>
:root{font-family:system-ui,-apple-system,sans-serif;color-scheme:dark;background:#15181d;color:#ecf0f6}
body{margin:0}header{position:sticky;top:0;background:#1c222bec;backdrop-filter:blur(7px);z-index:5;border-bottom:1px solid #444;padding:13px 20px}
h1{font-size:21px;margin:0 0 6px}p{margin:0 0 8px;color:#b9c6d4;font-size:13px}
.controls{display:flex;gap:9px;align-items:center;flex-wrap:wrap}button,select,input{font:inherit;font-size:13px;color:inherit;background:#303a48;border:1px solid #596575;border-radius:6px;padding:7px}
button{cursor:pointer}button:hover{background:#445265}button:disabled{opacity:.4;cursor:default}
button.primary{background:#256f62;border-color:#347e72}button.warn{background:#773c3c;border-color:#aa5555}
#stats{font-size:13px;font-weight:600}#grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(225px,1fr));gap:14px;margin:18px}
.card{border:1px solid #465061;border-radius:11px;overflow:hidden;background:#20252d}
.card img{display:block;width:100%;height:240px;object-fit:contain;background:#101217;cursor:zoom-in}
.info{padding:11px;display:flex;flex-direction:column;gap:7px}.info>label{display:flex;flex-direction:column;gap:3px;font-size:12px}
.info select{width:100%}.card button{width:100%}
.meta{color:#b5c0d0;font-size:12px;overflow-wrap:anywhere}
.card.reviewed{border-color:#287d60}.card.excluded{border-color:#a44b45;opacity:.7}
.actions{display:grid;grid-template-columns:1fr 1fr;gap:7px}
footer{padding:14px 20px;display:flex;gap:12px;justify-content:center;align-items:center}
#overlay{position:fixed;inset:0;background:#000e;display:none;place-items:center;z-index:10;cursor:zoom-out}
#overlay img{max-width:97vw;max-height:97vh;object-fit:contain}
a{color:#85bfff}#notice{font-size:13px;color:#b7e2cb}
</style></head><body><header><h1>Artes · Beeldbeoordeling</h1>
<p>De brongalerij staat al ingevuld. Dit is GEEN visueel gecontroleerd detectorlabel. Controleer afbeelding en leeftijd voordat je een foto goedkeurt. Bewerkingen worden apart opgeslagen, niet in de bestaande Artes dataset.</p>
<div class="controls"><span id="stats">Bezig met laden…</span>
<select id="filter"><option value="unreviewed">Nog beoordelen</option><option value="all">Alles</option><option value="reviewed">Beoordeeld</option><option value="excluded">Uitgesloten</option></select>
<select id="gallery"><option value="all">Alle brongalerijen</option></select>
<button id="backup">Exporteer beoordelingsbestand</button><span id="notice"></span></div></header>
<main id="grid"></main><footer><button id="prev">Vorige</button><span id="page"></span><button id="next">Volgende</button></footer>
<div id="overlay" title="Klik om te sluiten"><img alt="Uitvergroot voorbeeld"></div>
<script>
"use strict";
var items=[], progress={}, suggestions={}, page=0, pageSize=35, filter="unreviewed", gallery="all";
var nudity=["","none","underwear_swimwear","implied_nude","bare_buttocks","female_bare_breasts","genitalia","male_topless"];
var sexual=["","none","suggestive","bdsm_kink","explicit_act"];
var age=["","adult_clear","skip_minor_or_age_uncertain","not_required_nonadult_nonsexual"];
function html(s){return String(s).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]})}
function options(arr, value){return arr.map(function(v){return '<option value="'+html(v)+'"'+(v===value?' selected':'')+'>'+(v?html(v):"Nog niet ingevuld")+'</option>'}).join("")}
function status(item){return (progress[item.id]||{}).status||"unreviewed"}
function visible(){return items.filter(function(i){return (filter==="all"||status(i)===filter)&&(gallery==="all"||i.collection===gallery)})}
function render(){
 var reviewed=items.filter(function(i){return status(i)==="reviewed"}).length;
 var excluded=items.filter(function(i){return status(i)==="excluded"}).length;
 document.getElementById("stats").textContent=items.length+" foto's · "+reviewed+" beoordeeld · "+excluded+" uitgesloten · "+(items.length-reviewed-excluded)+" nog open";
 var list=visible(), pages=Math.max(1,Math.ceil(list.length/pageSize));page=Math.min(page,pages-1);
 var subset=list.slice(page*pageSize,(page+1)*pageSize);
 var g=document.getElementById("grid");
 g.innerHTML=subset.map(function(i){
 var p=progress[i.id]||suggestions[i.id]||{},s=status(i),file=encodeURIComponent(i.filename);
 return '<article class="card '+s+'" data-id="'+html(i.id)+'">'+
 '<img loading="lazy" src="/image/'+file+'" alt="Foto '+html(i.id)+'" data-zoom="/image/'+file+'">'+
 '<div class="info"><div class="meta"><strong>Bron: '+html(i.collection)+'</strong><br>'+
 html(i.id)+' · <a href="'+html(i.image_page)+'" target="_blank" rel="noopener">Originele fotopagina</a>'+(suggestions[i.id]?' · <b>Voorstel assistent, nog te bevestigen</b>':'')+(suggestions[i.id]?.originalReviewNeeded?' · <b style="color:#ffcc85">Origineel extra controleren</b>':'')+(suggestions[i.id]?.note?'<br><b style="color:#ffcc85">'+html(suggestions[i.id].note)+'</b>':'')+'</div>'+ 
 '<label>Naaktheid<select data-field="nudity">'+options(nudity,p.nudity||"")+'</select></label>'+
 '<label>Seksuele context<select data-field="sexualContext">'+options(sexual,p.sexualContext||"")+'</select></label>'+
 '<label>Leeftijdscontrole<select data-field="ageSafety">'+options(age,p.ageSafety||"")+'</select></label>'+
 '<div class="actions"><button class="primary" data-action="reviewed">Goedkeuren</button><button class="warn" data-action="excluded">Uitsluiten</button></div>'+
 '</div></article>'
 }).join("");
 document.getElementById("page").textContent=list.length?((page+1)+" / "+pages+" · "+list.length+" zichtbaar"):"Geen foto's in deze selectie";
 document.getElementById("prev").disabled=page===0;
 document.getElementById("next").disabled=page+1>=pages;
}
function idFor(el){return el.closest(".card").dataset.id}
async function save(id,changes){
 var old=Object.assign({},progress[id]||suggestions[id]||{}),next=Object.assign({},old,changes);
 progress[id]=next;
 var res=await fetch("/api/review",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:id,decision:next})});
 if(!res.ok){progress[id]=old;alert("Opslaan is mislukt: "+(await res.text()));return false}
 document.getElementById("notice").textContent="Automatisch opgeslagen";
 render();return true;
}
document.getElementById("grid").addEventListener("change",function(event){
 var sel=event.target;if(!sel.matches("select[data-field]"))return;
 var id=idFor(sel),change={};change[sel.dataset.field]=sel.value;
 save(id,Object.assign({status:"unreviewed"},change)).catch(function(e){alert(e.message)});
});
document.getElementById("grid").addEventListener("click",function(event){
 var zoom=event.target.getAttribute("data-zoom");
 if(zoom){document.querySelector("#overlay img").src=zoom;document.getElementById("overlay").style.display="grid";return}
 var action=event.target.dataset.action;if(!action)return;
 var id=idFor(event.target),p=progress[id]||suggestions[id]||{};
 if(action==="reviewed"&&(!p.nudity||!p.sexualContext||!p.ageSafety)){
   alert("Vul naaktheid, seksuele context en leeftijdscontrole in.");return
 }
 if(action==="reviewed"&&p.ageSafety==="skip_minor_or_age_uncertain"){alert("Onzekere leeftijd: gebruik Uitsluiten.");return}
 save(id,{status:action}).catch(function(e){alert(e.message)});
});
document.getElementById("overlay").addEventListener("click",function(){this.style.display="none";document.querySelector("#overlay img").src=""});
document.getElementById("filter").addEventListener("change",function(){filter=this.value;page=0;render()});
document.getElementById("gallery").addEventListener("change",function(){gallery=this.value;page=0;render()});
document.getElementById("prev").onclick=function(){page=Math.max(0,page-1);render();scrollTo(0,0)};
document.getElementById("next").onclick=function(){page++;render();scrollTo(0,0)};
document.getElementById("backup").onclick=function(){
 var blob=new Blob([JSON.stringify({version:1,reviewedAt:new Date().toISOString(),decisions:progress},null,2)],{type:"application/json"});
 var a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="Artes-photo-review-backup.json";a.click();setTimeout(function(){URL.revokeObjectURL(a.href)},1000);
};
fetch("/api/items").then(function(r){if(!r.ok)throw Error("Kan de beelden niet laden");return r.json()}).then(function(data){
 items=data.items;progress=data.progress;suggestions=data.suggestions||{};
 var cats=[...new Set(items.map(function(i){return i.collection}))];
 document.getElementById("gallery").innerHTML='<option value="all">Alle brongalerijen</option>'+cats.map(function(c){return '<option value="'+html(c)+'">'+html(c)+'</option>'}).join("");
 render()
}).catch(function(e){document.getElementById("stats").textContent=e.message});
</script></body></html>"""

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--folder", type=Path, default=DEFAULT_FOLDER)
    parser.add_argument("--port", type=int, default=8794)
    args = parser.parse_args()
    folder = args.folder.resolve()
    manifest = folder / "unreviewed-images.jsonl"
    if not manifest.is_file():
        raise SystemExit("Geen downloadmanifest gevonden: " + str(manifest))
    items = []
    for line in manifest.read_text(encoding="utf-8").splitlines():
        if line.strip():
            item = json.loads(line)
            img = Path(item["filename"])
            if img.is_file() and img.parent.resolve() == folder:
                items.append({"id": item["id"], "filename": img.name, "collection": item["collection"],
                              "source_page": item["source_page"], "image_page": item["image_page"]})
    if not items:
        raise SystemExit("Geen lokale afbeeldingen beschikbaar in " + str(folder))
    by_id = {item["id"]: item for item in items}
    suggestions_path = folder / "assistant-visual-prefill.json"
    suggestions = {}
    if suggestions_path.is_file():
        prefill = json.loads(suggestions_path.read_text(encoding="utf-8"))
        if prefill.get("method") != "assistant_manual_visual_review":
            raise SystemExit("Voorinvulling moet gebaseerd zijn op onafhankelijke visuele beoordeling.")
        for entry in prefill.get("items", []):
            ident = entry.get("id")
            if ident not in by_id:
                continue
            vals = {"nudity": entry.get("nudity", ""),
                    "sexualContext": entry.get("sexualContext", ""),
                    "ageSafety": entry.get("ageSafety", ""),
                    "originalReviewNeeded": bool(entry.get("originalReviewNeeded")),
                    "note": str(entry.get("note", ""))[:300],
                    "assistantLabelConfidence": str(entry.get("assistantLabelConfidence", "medium"))}
            if vals["nudity"] in NUDITY and vals["sexualContext"] in SEXUAL and vals["ageSafety"] in AGE:
                suggestions[ident] = vals
    progress_path = folder / "photo-review-progress.json"
    if progress_path.is_file():
        progress = json.loads(progress_path.read_text(encoding="utf-8"))
    else:
        progress = {}
    class Handler(BaseHTTPRequestHandler):
        def send(self, status, content, ctype):
            self.send_response(status)
            self.send_header("Content-Type", ctype)
            self.send_header("Cache-Control", "no-store" if ctype.startswith("application/json") else "private, max-age=3600")
            self.send_header("Content-Length", str(len(content)))
            self.end_headers()
            self.wfile.write(content)
        def do_GET(self):
            parsed = urlparse(self.path).path
            if parsed == "/":
                return self.send(200, HTML.encode("utf-8"), "text/html; charset=utf-8")
            if parsed == "/api/items":
                payload = json.dumps({"items": items, "progress": progress, "suggestions": suggestions}, ensure_ascii=False).encode("utf-8")
                return self.send(200, payload, "application/json; charset=utf-8")
            if parsed.startswith("/image/"):
                name = unquote(parsed[len("/image/"):])
                if name != Path(name).name or not name.lower().endswith((".jpg", ".jpeg", ".png", ".webp")):
                    return self.send(404, b"not found", "text/plain")
                f = folder / name
                if not f.is_file() or f.stat().st_size > 12*1024*1024:
                    return self.send(404, b"not found", "text/plain")
                ct = "image/webp" if name.endswith(".webp") else ("image/png" if name.endswith(".png") else "image/jpeg")
                return self.send(200, f.read_bytes(), ct)
            return self.send(404, b"not found", "text/plain")
        def do_POST(self):
            if self.path != "/api/review":
                return self.send(404, b"not found", "text/plain")
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if length < 2 or length > 10000:
                    raise ValueError("invalid payload size")
                data = json.loads(self.rfile.read(length))
                key = data.get("id")
                decision = data.get("decision")
                if key not in by_id or not isinstance(decision, dict):
                    raise ValueError("unknown photo")
                if (decision.get("status", "unreviewed") not in STATUS
                    or decision.get("nudity", "") not in NUDITY
                    or decision.get("sexualContext", "") not in SEXUAL
                    or decision.get("ageSafety", "") not in AGE):
                    raise ValueError("invalid review value")
                if decision.get("status") == "reviewed" and (not decision.get("nudity") or not decision.get("sexualContext") or
                        decision.get("ageSafety") in ("", "skip_minor_or_age_uncertain")):
                    raise ValueError("review requires valid adult safety and detector labels")
                normalized = {k: decision.get(k, "") for k in ("nudity", "sexualContext", "ageSafety")}
                normalized["status"] = decision.get("status", "unreviewed")
                progress[key] = normalized
                temp = progress_path.with_suffix(".json.tmp")
                temp.write_text(json.dumps(progress, indent=2, ensure_ascii=False), encoding="utf-8")
                os.replace(temp, progress_path)
                return self.send(200, b'{"ok":true}', "application/json")
            except (ValueError, TypeError, KeyError, json.JSONDecodeError) as exc:
                return self.send(400, str(exc).encode("utf-8"), "text/plain; charset=utf-8")
    print("Artes beeldbeoordeling: " + str(len(items)) + " foto's")
    print("Open in Codespaces via Ports > 8794 > Open in Browser")
    print("Voorstellen na visuele beoordeling: " + str(len(suggestions)))
    print("Voortgang wordt lokaal opgeslagen: " + str(progress_path))
    print("Stoppen: Ctrl+C")
    with ThreadingHTTPServer(("127.0.0.1", args.port), Handler) as server:
        server.serve_forever()

if __name__ == "__main__":
    main()
