# Qu-Rewrite: ActivityPub als einzige native Basis-Architektur

## Kontext

Qu (Repo `/home/user/QuV3`) hat heute einen vollständig proprietären Netzwerk-/Sync-Stack (`QuBit`, `QuStore`/`mount.js`, `SyncEngine`, `AccessEngine`). Kein AP-Code existiert im Repo — vollständiges Greenfield.

Dieser Plan ist das Ergebnis mehrerer Diskussionsrunden, in denen die Richtung schrittweise geschärft wurde: von "AP als zusätzlicher Föderationskanal" über "AP als Basis, Qu-Core bleibt parallel für lokale Daten" zur finalen, hier festgehaltenen Entscheidung: **ein einziges Datenmodell, eine Reactivity, ein Wire-Format — für föderierte UND lokale Daten.** Qu-Core (`QuStore`/`QuBit`/`mount.js`/`AccessEngine`/`SyncEngine`) wird vollständig durch die AP-native Schicht ersetzt, nicht nur ergänzt oder im Geltungsbereich verengt. Was bleibt, ist ausschließlich das, was AP strukturell nicht liefert: Keypair-Identität, Verschlüsselung, ein granulares internes Event-/Reactivity-System und ein modularer Transport-Layer.

**Bindende Entscheidungen dieses Plans:**
1. Voller Rewrite. Alles, was AP bereits liefert, wird nicht dupliziert.
2. Zugriffskontrolle ausschließlich über AP-Audience/Group — für föderierte UND private/lokale Daten gleichermaßen. Keine separate Qu-ACL.
3. Kein Qu-Core-Store mehr. `QuStore`/`QuBit`/`mount.js` entfallen vollständig. Auch Client-/App-Einstellungen werden native AS2-Objekte, nicht in ein Qu-eigenes Format verpackt.
4. `QuEvents` bleibt (unverändert im Code), wird aber zum alleinigen, granularen internen Event-Bus, der sowohl lokale Reactivity als auch den Realtime-Kanal speist — mit einem **einheitlichen Wire-Envelope** (ein Frame-Format mit `kind`-Feld), nicht zwei parallelen Protokollen.
5. Identität bleibt Ed25519/Multikey (HD-Derivation via bestehendem `QuIdentityEngine`). Zusätzlich bekommt jeder Actor ein wegwerfbares RSA-2048-Transport-Keypair nur für die äußere HTTP-Signature-Hülle (Mastodon-Kompatibilität) — ohne Identitätsbedeutung.
6. Kein Datenbestand zu migrieren.
7. **Drei Datenlokalitäts-Klassen** (neu präzisiert, siehe unten): geräte-lokal (nie synced), privat-geräteübergreifend (verschlüsselt über eine persönliche Geräte-Gruppe), föderiert/sozial (öffentlich oder gruppenadressiert). Private Daten sind **strukturell erzwungen verschlüsselt** — nie unverschlüsselt auf einem Relay, weder im Transport noch im Ruhezustand.
8. **Drei Event-Durability-Stufen** als generisches, wiederverwendbares Konzept (nicht nur für Signaling/GeoChase, sondern auch für zukünftige Mehrgeräte-Szenarien wie CMS-Kollaboration oder Präsentationsmodus): ephemeral (nie gespeichert), session-scoped (lebt nur für die Dauer einer Session), persistent (normales AS2-Activity-Log mit Offline-Zustellung).
9. Ein einziges Reactivity-/Publish-API für App-Entwickler (`packages/ap-client`: `publish()`/`watch()`) — egal ob die Daten öffentlich, gruppenadressiert oder privat-persönlich sind. Kein zweites, QuStore-artiges API daneben.

---

## Leitprinzip

Für jede bestehende Datei/jeden Mechanismus gilt eine von drei Antworten:
1. **Liefert AP das schon (Actor, Audience, Activity-Log, Collections)?** → löschen, AP-nativ nutzen.
2. **Plattformunabhängige Infrastruktur, die AP nicht ersetzt (Krypto, Adapter-Interface, Cursor-Logik, WebRTC-Mechanik)?** → 1:1 behalten.
3. **Qu-Erweiterung, die AP nicht kennt (Verschlüsselung, Ephemeral/Session-Events, modularer Transport, HD-Identity)?** → als `qu:`-Namespace neu bauen.

---

## Datenlokalitäts-Klassen

| Klasse | Beispiele | Speicherort | Sync | Verschlüsselung |
|---|---|---|---|---|
| **A — Geräte-lokal** | Scroll-Position, Entwurfstext vor dem Senden, UI-Zwischenzustand | direkt `localStorage`/`sessionStorage`/Memory über die bestehenden Adapter (`packages/runtime/src/{local-storage-adapter,session-storage-adapter}.js`) | nie | n/a — verlässt das Gerät nie |
| **B — Privat, geräteübergreifend** | Profil-Einstellungen, App-Präferenzen, Theme/Sprache | AS2-Objekt im selben `ap-store`, `qu:federate: false` | über eine **persönliche Geräte-Gruppe** (s.u.) | **verpflichtend** — nie unverschlüsselt auf einem Relay |
| **C — Föderiert/sozial** | Chat, Forum, Kalender, Reaktionen, GeoChase-Spielstand | AS2-Objekt/Activity, normal föderiert | AP S2S + Realtime-Kanal | optional, je nach Visibility |

**Klasse B — persönliche Geräte-Gruppe:** Jede Identität besitzt implizit einen eigenen, nicht auffindbaren `Group`-Actor ("meine Geräte"). Jedes eingeloggte Gerät wird über denselben Join/Accept-Mechanismus wie jede andere Gruppe Mitglied (Pairing-Flow: neues Gerät fordert Beitritt an, ein bestehendes Gerät bestätigt — analog QR-Code-Pairing). Einstellungsobjekte werden an diese Gruppe adressiert und mit dem `qu:encryptedPayload`-Mechanismus (§ Verschlüsselung) für jedes Mitgliedsgerät einzeln gewrappt. Vorteil gegenüber "gleicher Seed auf allen Geräten": einzelne Geräte sind individuell revozierbar (verlorenes Handy → aus der Gruppe entfernen), ohne den ganzen Seed zu rotieren. Der Pairing-Flow selbst ist neue Produktarbeit — als eigener, klar abgegrenzter Baustein geplant (s. Phasen), nicht Teil des MVP-Kritischpfads.

Damit deckt **ein einziger Mechanismus** (Group + Audience + Encryption) drei bisher getrennt gedachte Fälle ab: private Chat-Gruppen, Spielgruppen — und jetzt auch private Geräte-Synchronisation. Kein Sonderfall im Code nötig.

---

## Event-Durability-Stufen

Jede Activity/jedes Event deklariert eine Stufe (`qu:durability`), die Routing/Speicherung bestimmt:

| Stufe | Speicherung | Zustellung | Beispiele |
|---|---|---|---|
| **ephemeral** | nirgends, nur `VolatileAdapter`-Dedup-Fenster | best-effort, einmalig, live-only | WebRTC-Signaling (`qu:Signal`), Live-Cursor in Kollaboration |
| **session** | `VolatileAdapter`-artiger State, gebunden an eine `qu:session`-ID, lebt nur solange die Session aktiv ist | an aktuell verbundene Session-Teilnehmer, keine Zustellung an später Beitretende (außer expliziter Snapshot durch die App) | GeoChase-Live-Position, Präsentationsmodus-Foliensynchronisation, CMS-Kollaborations-Cursor |
| **persistent** | normales AS2-Objekt/Activity-Log in `ap-store` | Inbox/Outbox + Web-Push bei Offline-Empfänger, wiederholbar über `qu:Resume` | Chat-Nachrichten, Forum-Posts, Reaktionen, GeoChase-Streckenverlauf (aggregiert) |

Diese Dreiteilung ist bewusst generisch gehalten — sie bedient nicht nur die heute bekannten Fälle (Signaling, GeoChase-Tracking), sondern ist die vorgesehene Grundlage für spätere Mehrgeräte-/Mehrnutzer-Szenarien (kollaboratives CMS, Präsentationsmodus mit mehreren Clients), die im selben granularen Event-System ankommen sollen, ohne einen neuen Mechanismus zu brauchen.

---

## Ziel-Package-Struktur

### Komplett gelöscht
`packages/sync/` (SyncEngine-Wire-Protokoll; die generische `Transport`-Schnittstelle selbst wandert nach `packages/ap-realtime`), `packages/engines/` (gesamt, inkl. `access-engine.js`), `packages/core/src/{qubit,store,mount}.js`, `packages/relay/src/transports/websocket-server-transport.js`, `apps/shell/src/sync.js`, ~90% von `packages/services/` (Rest wie zuvor identifiziert: `paths.js`, `access-service.js`, `entity-service.js`, `entity-types.js`, `message-service.js`, `channel-service.js`, `chat-service.js`, `presence-service.js`, `contacts-service.js`, `directory-service.js`, `sharing-service.js`, `list-service.js`, `asset-service.js`, `commentable-service.js`, `favorites-service.js`, `sync-freshness.js`, `private-storage.js`, `webrtc-signal-service.js`, `unwrap.js`, `crypto-envelope.js`).

### Gerettet
`packages/content-format/` (neu) übernimmt reine Darstellungshelfer ohne Datenmodellbezug aus `packages/services/`: `content.js`, `link-detect.js`, `mention-service.js` (Parse-Hälfte), `actor-format.js`, `thread-formatting.js` (Render-Hälfte).

### Unverändert behalten
`packages/core/src/crypto.js`, `packages/core/src/events.js` (QuEvents — jetzt alleiniger Event-Bus), `packages/core/src/adapters/{cursor,memory,volatile}.js`, `packages/identity/` (mit Vault-Anpassung, s.u.), `packages/foundation/`, `packages/loader/`, `packages/runtime/` (alle Storage-Adapter — dienen jetzt sowohl als Backing für `ap-store` als auch direkt für Klasse-A-Gerätedaten), `packages/webrtc/src/{peer-connection,webrtc-transport,ice-config,webrtc-adapter}.js`, `packages/push`, `packages/i18n`, `packages/ui`, `packages/thread-ui`, `packages/content-ui` (letztere drei mit neuer interner Implementierung gegen `ap-store`, s.u., aber unveränderter Custom-Element-API für App-Autoren).

### Neu / grundlegend überarbeitet
```
packages/as2/            # AS2/JSON-LD-Vokabular, ID-Vergabe, Audience-Normalisierung, JCS-Kanonisierung
packages/ap-core/        # Multikey (Ed25519+RSA-Transport), Actor-Bau, WebFinger, NodeInfo,
                          # HTTP-Signatures, qu:proof, signierter Fetch, Collection-Serialisierung
packages/ap-store/       # AS2-Objekt-Store für ALLE drei Datenklassen (B und C; A bleibt außerhalb).
                          # get()/put()/getChildren()/onChange() als EINZIGE Storage-API im System.
packages/ap-ingest/      # verify -> authorize -> side-effect -> persist -> notify (auch für Klasse B)
packages/ap-delivery/    # Audience->Inbox-Auflösung, Retry-Queue nach Durability-Stufe getrennt,
                          # Web-Push-Nachfolger
packages/ap-realtime/    # Transport-Interface (übernommen aus packages/sync/src/transport.js) +
                          # Implementierungen: WebSocket, neu HTTPS+SSE, Anbindung an Web Push.
                          # EIN Wire-Envelope (kind: object|activity|ephemeral|session) für alles.
packages/ap-groups/      # Group-Actor inkl. der persönlichen "meine Geräte"-Gruppe (Klasse B)
packages/ap-encryption/  # qu:encryptedPayload über QuCrypto, Enforcement-Guards (s.u.),
                          # Device-Pairing-Flow für die persönliche Gruppe
packages/ap-signal/      # qu:Signal (ephemeral-Tier), Interface für webrtc-transport.js
packages/ap-client/      # publish({visibility, durability, type, fields}) und watch() —
                          # DIE EINE API für App-Entwickler, für alle drei Datenklassen identisch nutzbar
packages/reactive/       # watch()/watchChildren() komplett neu gegen ap-store's onChange()/getChildren()
                          # gebaut — keine Altlast aus dem alten QuStore. Öffentliche API bleibt stabil,
                          # damit packages/ui's QuComponents (<qu-view>, <qu-list>, ...) unverändert
                          # weiterfunktionieren, nur die Quelle unter der Haube wechselt.
packages/content-format/ # gerettete Darstellungshelfer
```

### `packages/relay` — Umbau
`relay.js` bleibt `RuntimeContainer`-Komposition, tauscht alle Bestandteile. Neu: `packages/relay/src/ap-router.js` mit Standard-AP-Routen (WebFinger, NodeInfo, Actor, Inbox/Outbox, Followers/Following, sharedInbox, Objects/Activities, Media). `http-router.js` behält Healthcheck, App-/Shell-Serving, Push-Endpunkte.

### Identity-Anpassung
`QuIdentityEngine` wird auf `packages/local-vault` (neu, physisch von jedem Sync-/Delivery-Pfad getrennter KV-Store für den rohen Seed und das RSA-Transport-Keypair) umgestellt — Ersatz für die heutige `LOCAL_ONLY_PREFIX`-Konvention.

---

## Storage-Modell (`packages/ap-store`)

Wie im Vorentwurf: drei Record-Typen (Object/Activity/Ephemeral — Ephemeral jetzt erweitert um "Session", s.o.), Record-Shape mit `.ts`-Feld kompatibel zu den bestehenden Adaptern (`FsAdapter`, `IndexedDBAdapter`, `cursor.js` — **keine Änderung nötig**, größter Wiederverwendungsgewinn). Index-Bäume (`/ap/idx/...`) liefern `getChildren()` direkt als `OrderedCollectionPage`. Klasse-B-Daten (private Settings) landen im selben Baum wie Klasse-C-Daten, unterscheiden sich nur durch `qu:federate:false` (nie an fremde Server ausgeliefert) und verpflichtendes `qu:encrypted:true`.

`packages/reactive`'s neues `watch(path, callback)` ruft `ap-store.get(path)` bei jeder `onChange()`-Benachrichtigung — das gleiche Verhaltensmuster wie das heutige `watch()` (immer über die volle Read-Pipeline lesen, nie den rohen Event-Payload direkt verwenden), nur an die neue Store-API angebunden. `packages/ui`'s QuComponents (`<qu-view>`, `<qu-bind>`, `<qu-list>`, `<qu-if>`) ändern sich für App-Autoren nicht sichtbar.

---

## Actor-/Identity-Mapping, ACL/Audience, Realtime, Signaling, App-Migration, Phasen, Risiken

Diese Abschnitte übernehmen die im Rewrite-Entwurf bereits detailliert ausgearbeitete Struktur, jetzt konsistent auf "keine Qu-Core-Reste" bereinigt:

- **Actor-Mapping**: Ed25519-Multikey + RSA-Transport-Key im Actor-Dokument, Main-/Space-Actors, WebFinger-Handles wie zuvor geplant.
- **ACL/Audience**: `principalSetOf()`/`canRead()` als einzige Leseprüfung — gilt jetzt explizit auch für Klasse-B-Daten (Audience = persönliche Geräte-Gruppe statt einer Social-Gruppe, sonst identischer Mechanismus). Owner-/Origin-/Signatur-/Gruppen-Regel in `ap-ingest/authorize.js` unverändert.
- **Realtime-Kanal**: EIN Wire-Envelope (`qu:StreamFrame` mit `kind: object|activity|ephemeral|session`) statt getrennter QuBit-Sync- und AP-Activity-Formate. Transport modular: WebSocket (Standard), HTTPS+SSE (neu, für restriktive Netze/einfache Polling-Fälle), Web Push (Offline-Zustellung der `persistent`-Stufe). `qu:Resume{since}` für Reconnect, gerettete Outbox-Semantik für ausgehende Writes.
- **Verschlüsselung**: `qu:encryptedPayload` = Serialisierung von `QuCrypto.encrypt()`. **Verschärfte Guard-Regel** gegenüber dem Vorentwurf: nicht nur "verschlüsselt+öffentlich → throw", sondern zusätzlich **"privates Visibility (direct/group/self) UND nicht verschlüsselt → throw"** (mit explizitem, bewusst unbequemem Opt-out-Flag für seltene Legacy-Fälle). Das setzt strukturell durch, dass private Daten nie unverschlüsselt das Gerät verlassen oder auf einem Relay landen.
- **Signaling**: `qu:Signal` als konkretes Beispiel der `ephemeral`-Durability-Stufe, unverändert vom Vorentwurf.
- **App-Migration**: Mapping-Tabelle unverändert (Chat als PoC, Calendar als sauberstes Mapping, etc.), GeoChase-Live-Tracking jetzt explizit als `session`-Tier-Beispiel, Track-Aggregation als `persistent`-Tier-Beispiel. Neu: `apps/shell`'s Settings/Profil-UI wird zum ersten Verbraucher der Klasse-B-Geräte-Gruppe.
- **Manifest**: `as2.{produces, consumes, defaultVisibility, ephemeralTypes, customTypes}` wie geplant, ergänzt um `as2.durability`-Deklaration pro produziertem Typ.

**Phasen** (angepasst gegenüber dem Vorentwurf):
- **Phase 0** — Fundament: `packages/as2`, `packages/ap-core` (inkl. RSA-Transport-Key), `packages/local-vault`.
- **Phase 1** — `packages/ap-store` (alle drei Datenklassen B+C), `packages/reactive` neu gegen `ap-store`, `packages/ui` QuComponents auf neue Quelle umgestellt und smoke-getestet.
- **Phase 2** — `packages/ap-core`-Serverseite, `packages/ap-ingest`, `packages/ap-delivery` (persistent-Tier), `ap-router.js`. **Meilenstein M1**: echte Mastodon-Interop.
- **Phase 3** — `packages/ap-realtime` (einheitlicher Envelope, WebSocket+SSE), `packages/ap-client`. **Meilenstein M2**: Live-Update zwischen zwei Tabs, Offline/Reconnect verlustfrei.
- **Phase 4** — `packages/ap-groups` (inkl. persönlicher Geräte-Gruppe + Pairing-Flow), `packages/ap-encryption` (inkl. verschärfter Guard-Regel), Web Push. **Meilenstein M3**: Gruppen-E2EE nachweislich, UND: Profil-Einstellung auf Gerät A geändert erscheint verschlüsselt auf Gerät B.
- **Phase 5** — PoC-Apps: `apps/_template`, `apps/chat`, `apps/shell`-Settings (Klasse B), `apps/notifications`.
- **Phase 6** — Abriss des alten Stacks in einem Commit.
- **Phase 7** — Rest-Apps nach Schwierigkeit aufsteigend.
- **Phase 8** — `packages/ap-signal`, `apps/phone`, `apps/geochase` (jetzt mit expliziter ephemeral/session/persistent-Aufteilung als Referenzimplementierung der Durability-Stufen für spätere Mehrgeräte-Apps wie CMS/Präsentationsmodus).
- **Phase 9** — Föderations-Härtung (Moderation, Allow-Listen, Rate-Limits, DSGVO-Löschpfad).

**Risiken** (Ergänzungen gegenüber dem Vorentwurf):
- **Device-Pairing-Flow ist neue Produktarbeit**, kein reines Architektur-Rezept — braucht eigenes UX-Design (QR-Code o.ä.), sollte nicht den kritischen Pfad bis M1–M3 blockieren; MVP kann vorübergehend mit "gleicher Seed auf jedem Gerät" starten, sofern das dem Nutzer explizit als Übergangslösung kommuniziert wird.
- **Verschärfte Verschlüsselungs-Pflicht** erhöht die Fehlerfläche an der Publish-API-Grenze (jede App muss `durability`+`visibility` korrekt deklarieren) — durch Guard+Test abgesichert, aber erhöht die Sorgfaltspflicht bei jeder neuen App.
- Alle bereits im Vorentwurf genannten Risiken (Fan-out-Skalierung, zweistufiges Signaturmodell, Verlust generischer Pfad-Flexibilität, DSGVO/Moderation, Testbarkeit, Dependency-Politik JCS vs. RDFC, Aufwandsrealismus mit M1 als kritischem Wendepunkt) gelten unverändert weiter.

---

## Kritische Dateien

- `packages/core/src/adapters/cursor.js`, `packages/runtime/src/{fs-adapter,indexeddb-adapter,local-storage-adapter,session-storage-adapter}.js` — bleiben die einzige Storage-Grundlage, sowohl für `ap-store` als auch direkt für Klasse-A-Gerätedaten.
- `packages/core/src/crypto.js` — Basis für `qu:encryptedPayload` und die persönliche Geräte-Gruppen-Verschlüsselung.
- `packages/identity/src/identity.js` — Actor-Key-Quelle, Umbaupunkt auf `packages/local-vault`.
- `packages/reactive/src/watch.js` — heutiges Verhalten (immer über volle Read-Pipeline lesen) als Vorlage für die Neuimplementierung gegen `ap-store`.
- `packages/ui/src/components.js` — QuComponents; öffentliche Custom-Element-API muss stabil bleiben, während die interne Datenquelle wechselt.
- `packages/sync/src/transport.js` — die generische `Transport`-Schnittstelle, die nach `packages/ap-realtime` wandert und um eine SSE-Implementierung ergänzt wird.
- `packages/foundation/src/manifest.js` — Erweiterung um `as2.*` inkl. `durability`.

## Verifikation

- Phase 1: `node --test` gegen `ap-store` inkl. eines Tests, der beweist, dass `<qu-view>`/`watch()` weiterhin auf einem einfachen Pfad funktionieren (Regressionstest für die QuComponents-Kompatibilität).
- Phase 2: Meilenstein M1 gegen echte Mastodon-Instanz.
- Phase 3: Meilenstein M2 (Realtime, Offline/Reconnect) über den neuen einheitlichen Envelope, inkl. Test für alle drei `kind`-Varianten.
- Phase 4: Meilenstein M3, erweitert um einen Test, der eine Profiländerung auf Gerät A verschlüsselt bei Gerät B ankommen lässt und beweist, dass das Relay den Klartext nicht lesen kann.
- Phase 5: `apps/chat` als Ende-zu-Ende-PoC; `apps/shell`-Settings als PoC für Klasse B.
- Phase 8: reale Messung von Ephemeral-/Session-Tier-Latenz als Referenzwert für künftige Mehrgeräte-Apps.

---

## Ergänzung: Plattform „Quniverse", Offline-First, QuRelay/QuServer, CMS im Fediverse

Diese Sektion ergänzt den obigen Plan um vier konkretisierende Entscheidungen und die Produktvision, die die Architektur einrahmt. Sie ist genauso bindend wie die Entscheidungsliste am Dokumentanfang — bei Widerspruch gilt die spätere (diese) Fassung, sie präzisiert, ersetzt aber nicht die Grundprinzipien (ein Datenmodell, AP-Audience als einzige ACL, drei Lokalitätsklassen, drei Durability-Stufen).

### 1. Offline- und Mobile-First als Kernanforderung, nicht als Nebeneffekt

`packages/ap-store` ist client-seitig immer eine **lokale, vollständige Kopie** (IndexedDB im Browser, Fs im Node-Kontext) — nie nur ein Cache, der bei fehlendem Netz leerläuft. Zwei Mechanismen, beide bereits als Konzept im Plan angelegt (Adapter/Cursor-Logik, Retry-Queue in `ap-delivery`), werden hier explizit zur Pflichtanforderung von Phase 1–3 erklärt statt optionalem Ausbau:

- **Outbox:** Jede lokal erzeugte Activity/jedes Objekt wird sofort lokal persistiert und als `pending` markiert, unabhängig vom Netzwerkstatus. `packages/ap-delivery` versucht Zustellung; bei fehlender Verbindung bleibt der Eintrag in der lokalen Outbox-Queue und wird beim Online-Gehen automatisch nachgeliefert (`qu:Resume{since}`-Mechanismus, s. Realtime-Kanal). App-Autoren sehen davon nichts — `ap-client.publish()` schreibt immer sofort lokal und liefert optimistisch zurück.
- **Inbox-Pull:** Symmetrisch dazu holt der Client beim (Wieder-)Verbinden ausstehende eingehende Activities ab (`qu:Resume{since}` gegen die eigene Inbox-Collection), bevor/während der Realtime-Kanal wieder aufgebaut wird — kein Datenverlust bei Offline-Phasen auf keiner Seite.
- Das ist kein neuer Layer: Es ist die bestehende `ap-store`+`ap-delivery`+`ap-realtime`-Kombination, deren Offline-Verhalten hiermit zur getesteten Pflichteigenschaft wird (s. Verifikation unten), nicht nur zur Möglichkeit.

### 2. QuRelay = AP-Server/-Relay **und** Qu-Erweiterung in einem Deployment

„QuRelay" ist der Gesamtbegriff für **einen** Serverprozess, der zwei Rollen gleichzeitig spielt — kein separates Duo aus AP-Server und „Qu-Backend". Das war im ursprünglichen Plan bereits durch `ap-router.js` (AP-Rolle) + `http-router.js` (Qu-Rolle) im selben `RuntimeContainer` angelegt (s. „`packages/relay` — Umbau" oben); diese Ergänzung macht es zur expliziten Namenskonvention:

- **AP-Server-Rolle** (`ap-router.js`): WebFinger, NodeInfo, Actor, Inbox/Outbox, Followers/Following, sharedInbox, Objects/Activities, Media — Standard-AP-Föderation.
- **Qu-Erweiterungsrolle** (`http-router.js`, hier **„QuServer"** genannt): PWA-/App-Hosting (`apps.json`, `config.json`, Shell-Serving — wie heute), Web-Push-Endpunkte, und **Push-/Realtime-Event-Generierung und -Routing zu verbundenen Clients** (s. Punkt 4).

Beide Rollen teilen sich Prozess, Port und `RuntimeContainer`-Komposition. „QuRelay" bezeichnet die Kombination; „QuServer" ist kein eigenständiger Prozess, sondern der Name für die Qu-eigene Rollenhälfte von QuRelay, wenn man sie von der AP-Standard-Hälfte abgrenzen will.

### 3. Storage-Konsolidierung: nur noch zwei Speicherebenen

Mit `packages/ap-store` als alleiniger Storage-API für alles Geteilte/Synchronisierte (Klassen B+C, optional verschlüsselt) entfällt jeder Sonderfall für "Sync-only"-Speicherung. Es gibt ab jetzt exakt zwei Speicherebenen im gesamten System:

1. **Lokal** (Klasse A, nie synced, direkt über `packages/runtime`-Adapter) — **plus** die lokale `ap-store`-Kopie als Offline-Cache/Outbox/Inbox-Queue für B+C (s. Punkt 1; das ist weiterhin „lokal", aber referenziert dieselben AS2-Objekte wie die Relay-Seite, kein eigenes Format).
2. **AP-seitig** (`ap-store` auf QuRelay, Klassen B+C, Zustellung über `ap-delivery`/`ap-realtime`).

Kein drittes, Qu-eigenes Speicherformat mehr — das war schon Entscheidung 3 im Hauptplan, wird hier nur um die explizite Zwei-Ebenen-Sicht ergänzt (lokal vs. AP-seitig, nicht lokal vs. Relay vs. sonstiges Sync-Protokoll).

### 4. AP-Server-Unterbau: schlank, aber hook-/event-erweiterbar

`ap-router.js` wird **nicht** auf einer vollständigen Drittanbieter-AP-Serverbibliothek aufgebaut (widerspräche der minimalen Dependency-Politik, s. `docs/rewrite-plan.md`-Anhang und `CLAUDE.md`), sondern selbst gebaut — jedoch mit klar definierten Hook-Punkten, die über den bestehenden `QuEvents`-Bus laufen (kein zweiter Hook-Mechanismus):

- Definierte Hook-Punkte in `ap-ingest`: `beforeVerify`, `afterVerify`, `beforeAuthorize`, `afterAuthorize`, `beforeSideEffect`, `afterPersist`, `beforeNotify` — jeweils als `QuEvents`-Emissionen, auf die andere Packages/Apps sich einklinken können (z.B. für Moderation, Lemmy-/Pixelfed-Kompatibilitätsanpassungen, CMS-Rendering-Trigger), ohne `ap-ingest` selbst zu verändern.
- Gleiches Muster in `ap-delivery` (`beforeDeliver`/`afterDeliver`/`onDeliveryFailed`) und in `http-router.js`/QuServer-Rolle (`beforePushRoute`/`afterPushRoute`) für Punkt 4's Push-Routing.
- Diese Hooks sind die *einzige* Erweiterungsschnittstelle des AP-Servers — kein Plugin-System zusätzlich zu `packages/foundation`s Extension-Points, sondern dieselbe `QuEvents`-Infrastruktur konsequent weitergenutzt.

**Push-Event-Generierung/-Routing** (Teil der QuServer-Rolle): Wenn `ap-delivery` eine `persistent`-Activity für einen aktuell offline/nicht-realtime-verbundenen Empfänger nicht per WebSocket/SSE zustellen kann, generiert QuServer daraus einen Web-Push-Event (VAPID/RFC 8291, wie heute in `push-delivery.js`) und routet ihn an die registrierten Push-Subscriptions des Empfänger-Actors. Das ist keine neue Komponente, sondern die bestehende `packages/push`-Funktionalität, jetzt explizit als QuServer-Zuständigkeit benannt und an die `ap-delivery`-Retry-Queue (s. Event-Durability-Tabelle) angebunden statt an das alte `SyncEngine`.

---

## Produktvision: die Plattform „Quniverse"

„Quniverse" ist der Name der App-/Plattform-Ebene, die auf QuRelay + QuClient (`packages/ap-client`, `packages/reactive`, `packages/ui`) aufbaut. Datenschutz ist das Leitprinzip, nicht ein Feature unter vielen: AP liefert die föderierte Grundlage, Quniverse fügt Verschlüsselung (Klasse B verpflichtend, Klasse C optional je Visibility, s. Guard-Regel oben) und Sicherheits-Extras hinzu, die AP selbst nicht kennt.

### App-Portfolio

- **Feeds** — die typischen AP-Timelines/Collections, immer mit lokalem Caching und Offline-First (s. Punkt 1) als Grundverhalten, nicht als App-spezifisches Extra.
- **Forum** — soll, wo sinnvoll, **Lemmy-kompatibel** werden: gleiche AS2-Aktivitäts-/Objekttypen und Community-/Group-Konventionen wie Lemmy verwenden, damit Quniverse-Foren mit Lemmy-Instanzen föderieren können. Kein 1:1-Reimplementierung von Lemmy-Code, sondern Kompatibilität auf Protokollebene — als Anforderung an das AS2-Mapping in Phase 5/7, nicht als neues Package.
- **Gallery** — soll perspektivisch eine **Pixelfed-kompatible** Darstellung bieten (Attachment-/Actor-Konventionen), analog zur Lemmy-Kompatibilität beim Forum.
- **Kalender** — Events sowohl öffentlich/geteilt (Klasse C) als auch privat (Klasse B über die persönliche Geräte-Gruppe oder eine private Social-Gruppe) — nutzt exakt den bestehenden Group+Audience+Encryption-Mechanismus, kein neuer Fall.
- **Mehrwert-Apps ohne AP-Standard-Vorbild** (das eigentliche Alleinstellungsmerkmal von Quniverse gegenüber reinen AP-Frontends): WebRTC-Signaling (`packages/ap-signal`), Phone, Chat/Messenger, Spiele wie GeoChase — alle über die drei Event-Durability-Stufen abgebildet (s. Tabelle oben), kein Sonderfall pro App.

### CMS/Website-Builder im Fediverse (neuer, eigenständiger Baustein)

Der bemerkenswerteste neue Baustein: eigene Inhalte (Blog, CMS-Seiten, ganze Websites) werden **vollständig als AS2-Objekte im Fediverse gespeichert** — nicht nur die Inhalte, sondern auch **Templates und Styles**:

- Neue `qu:`-Objekttypen (Detailarbeit für die entsprechende Phase, hier nur als Konzept benannt): `qu:Template` (HTML-Template-Dokument), `qu:Stylesheet`, plus die bereits vorhandenen AS2-Typen `Article`/`Page` für Inhalte. Alle drei folgen derselben Speicher-/Föderationslogik wie jedes andere AS2-Objekt — kein Sonderformat.
- **Public:** normal ins Fediverse föderiert, wie jeder andere öffentliche Inhalt (Klasse C, unverschlüsselt zulässig).
- **Private:** verschlüsselt gespeichert (verpflichtend, s. Guard-Regel) **und so weit möglich anonymisiert** — d.h. bei privaten CMS-Inhalten wird zusätzlich zur Verschlüsselung geprüft, dass Metadaten (Autor-Zuordnung, Zeitstempel-Granularität etc.) nicht unnötig Rückschlüsse zulassen. Konkrete Anonymisierungsregeln sind Detailarbeit der jeweiligen Phase, das Prinzip ist hier als Anforderung festgehalten.
- **QuClient als Editor:** Templates, Styles und Daten werden in einer QuClient-UI (Editor-App) bearbeitet — WYSIWYG- oder Struktur-Editor für eine komplette Website/einen Blog inklusive HTML-Templates, nicht nur der Textinhalte.
- **QuRelay als „QuWebserver":** QuRelay bekommt eine dritte, ergänzende Rolle (zusätzlich zu AP-Server und QuServer, s.o.): Es rendert aus den föderierten Template-/Style-/Content-Objekten serverseitig ausgelieferte Webseiten — dezentral, weil jede Quniverse-Instanz, die Template+Style+Content-Objekte eines Autors repliziert/föderiert hat, dieselbe Seite ausliefern kann. Kein zentraler Hosting-Punkt.
- Package-Konsequenz für spätere Phasen: `packages/ap-cms` (neu, Template-/Stylesheet-/Content-Typen, Rendering-Pipeline) und eine dritte Rolle in `packages/relay` (`cms-router.js` oder Erweiterung von `http-router.js`) — Detailplanung folgt in der jeweiligen Phase, hier nur als struktureller Platzhalter vermerkt, damit spätere Phasenplanung nicht bei null anfängt.

### Auswirkung auf die Phasenliste

Diese Ergänzung fügt der bestehenden Phasenliste keine neue Nummerierung hinzu, sondern präzisiert Phase 5/7 (App-Migration: Forum/Gallery-Kompatibilität als Anforderung) und markiert das CMS/Website-Builder-Feature als eigenständigen, nach Phase 8 einzuordnenden Baustein (`packages/ap-cms` + QuRelay-Webserver-Rolle), sobald `ap-store`, `ap-client` und `ap-groups`/`ap-encryption` stabil sind — er baut auf all diesen auf und sollte nicht vor Meilenstein M3 begonnen werden.

---

## Anhang: Ausgangslage QuV3 (Referenzarchitektur für den Rewrite)

Dieser Plan entstand für das Repo `ReactivityJS/QuV3` und wird in `ReactivityJS/QuV4` umgesetzt. QuV4 kennt QuV3 nicht automatisch — deshalb hier die verifizierten Kernfakten zu QuV3 als Referenz, damit alle im Plan genannten Dateipfade/Konzepte ("wie heute in `packages/...`") einordenbar bleiben, auch ohne direkten Zugriff auf das QuV3-Repo.

**Monorepo-Aufbau:** npm workspaces (`packages/*`, `apps/*`), plain ES modules, kein TypeScript/Bundler für den Source selbst (nur esbuild bündelt Browser-`clientMain`s), Node ≥20, `node --test` als Testrunner durchgehend. Externe Runtime-Dependencies bewusst minimal: nur `@scure/bip39` (Identity) und `ws` (Relay) — alles andere (BIP-39-Verifikation, SLIP-10, VAPID, Web-Push-Crypto, Base64) ist selbst gebaut. Docs: `README.md` (Statuslog), `docs/v3-architecture-spec.md`, `docs/v3-technical-concept.md`, `docs/v4-concept.md` (Entity/Content/Capability-Modell), `docs/building-an-app.md`, `docs/api-reference.md`. Kein `CLAUDE.md`.

**Datenmodell heute:**
- `QuBit` (`packages/core/src/qubit.js`) — das fundamentale, signierte Datenobjekt: `{path, val, ts, pub, sig}`. `path` = absoluter Qu-Pfad, `val` = Payload (Klartext oder `{iv,ct,to}`-Envelope), `pub`/`sig` = Ed25519-Signer/Signatur. Alles andere (Dokumente, Threads, Entities) ist Konvention obendrauf.
- `Entity` (nicht `QuEntity` — dieser Name existiert im Code nicht) — `EntityEngine` (`packages/engines/src/entity-engine.js`) + `EntityService` (`packages/services/src/entity-service.js`) + `EntityTypeRegistry`/`defaultEntityTypes` (`packages/services/src/entity-types.js`, 7 Typen: topic/message/article/page/notification/task/event, je mit `fields`/`content`/`capabilities`/`contentFormat`). Form: `{_id, _type, _created, ...fields}`.
- `QuEvents` (`packages/core/src/events.js`) — ein simpler In-Process-Pub/Sub-Bus (`on`/`once`/`emit`/`listenerCount`), NICHT das Datenmodell. Bleibt in diesem Plan als alleiniger interner Event-Bus erhalten.

**QuRelay** (`packages/relay/src/relay.js` + Module) — Node-Peer: `FsAdapter`-Persistenz, `SyncEngine`-Replikation, Web-Push (`push-delivery.js`, VAPID/RFC 8291), App-Hosting (`static-apps.js`, `apps-catalog.js`), Admin-API (`admin-http.js`), eigene Relay-Identität. Notification-Routing bereits pluggable (`resolveNotification`, manifest-`pushActions`). HTTP-Oberfläche: `http-router.js` (`/healthz`, `/apps.json`, `/config.json`, App-/Shell-Serving).

**QuClient = `apps/shell`** (kein Klassenname `QuClient`) — Browser-PWA, Composition Root. Boot-Sequenz laut `client.js`-Doc-Comment: Identity ready → Profil publizieren → Sync zum Relay verbinden (best-effort) → Preferences anwenden → PWA-UI mounten → Header mounten → Route dispatchen (`#/<appId>` → dynamischer Import + `mount()`). `apps/shell/src/sync.js` verbindet `SyncEngine` via `WebSocketClientTransport` im `publishAllTo`-Modus, gesichert durch `IndexedDBOutboxStore`.

**Apps/Mounts/Storage/Transports (Qu's Plugin-/Modulsystem):**
- Mounts (`packages/core/src/mount.js`): `store` (durabel, signiert), `blob` (durabel, Assets), `event` (lokal, `VolatileAdapter`), `net` (netzwerkseitig, von `@qu/sync` gewrappt).
- Storage-Adapter: `MemoryStoreAdapter`/`VolatileAdapter` (Core), `FsAdapter` (Relay/Node), `IndexedDBAdapter`/`local-storage-adapter.js`/`session-storage-adapter.js` (Browser, `packages/runtime/`) — gemeinsame `(ts,rel)`-Cursor-Logik in `packages/core/src/adapters/cursor.js`, Conformance-Testsuite über alle Adapter.
- Apps: `manifest.quapp`-Pakete unter `apps/*`, geladen via `@qu/loader` (`discoverLocalPackages()`, `QuLoader.loadLocal()`, `DependencyResolver`, `RemoteLoader` mit Integrity/Signature-Verifikation). Manifest-Felder: `name`/`version`/`main`/`clientMain`/`kind`(`engine|service|app`)/`requires`/`spaceId`/`pushActions`/`definesExtensionPoints`/`contributes`. Bestehende Apps: `app-list`, `bookmarks`, `calendar`, `chat`, `forum`, `geochase`, `notifications`, `phone`, `pins`, `profile`, `reactions`, `relay-admin`, `search`, `shell`, `todo`, `user-list`, `_template`.
- Extension-Points (`packages/foundation/src/extension-points.js`, `actions.js`, `hooks.js`, `registry.js`): `ui`/`menu`/`query`/`hook`-Kontributionen zwischen Apps.
- `RuntimeContainer` (`packages/foundation/src/runtime-container.js`) — Lazy-Singleton-Registry, Basis sowohl für `QuRelay` als auch (abgespeckt) `apps/shell`.
- **Transport-Abstraktion** (`packages/sync/src/transport.js`) — explizites, austauschbares 5-Methoden-Interface (`connect/send/sendTo/onMessage/getPeerId`). Zwei bestehende Implementierungen: `WebSocketClientTransport`/`WebSocketServerTransport` und `WebRTCTransport` (`packages/webrtc/`, Signaling über `WebRtcSignalService`). Dieses Interface ist im Rewrite-Plan die Basis für `packages/ap-realtime`.

**Sync-Protokoll** (`packages/sync/src/sync-engine.js`, ~1300 Zeilen) — eigenes pfadbasiertes Pub/Sub-Replikationsprotokoll (kein CRDT, kein Gossip, Standard-Topologie Client↔Relay-Stern). Nachrichtentypen: `sync`/`sync-ack`/`subscribe`/`unsubscribe`/`request`-`response`/`prefix-request`-`prefix-response`. Sicherheitskritisch: `#validateIncomingWrite()` prüft Form, Signatur (`isAuthentic()`), Autorisierung (`assertWriteAuthorized()` aus `@qu/engines`) — fehlerhafte/unautorisierte Writes werden still verworfen. `LOCAL_ONLY_PREFIX = '/store/secure/'` verlässt nie das Gerät (schützt den Identity-Seed). `QuStore.putSealed()` ist der Infrastruktur-Entry-Point für bereits signierte eingehende QuBits.

**Identity/Crypto:**
- `QuCrypto` (`packages/core/src/crypto.js`) — Stateless-Wrapper über Web Crypto: Ed25519 (Signieren), X25519 (ECDH), AES-256-GCM (Bulk-Verschlüsselung). `generateKeypair()`, `keypairFromSeed()`, `sign()`/`verify()`, `encrypt()`/`decrypt()` (Envelope: ein AES-Content-Key, pro Empfänger einzeln gewrappt via `to[]`), `sha256()`.
- `QuIdentityEngine` (`packages/identity/src/identity.js`) — ein BIP-39-24-Wort-Seed (`packages/identity/src/bip39.js`) → SLIP-10-HD-Derivation (`slip10.js`, `paths.js`: `mainSigningPath()`, `mainEncryptionPath()`, `spaceSigningPath(spaceId)`, `spaceEncryptionPath(spaceId)`, `ephemeralSigningPath(spaceId,index)`) → Main-/Space-/Ephemeral-Schlüssel, alle deterministisch neu ableitbar, kein gespeicherter Schlüsseltresor nötig. `getMainKey()`/`getMainXKey()`/`getSpaceKey()`/`getSpaceXKey()`/`getEphemeralKey()`. `publishMainProfile()`/`publishProfile()` schreiben signierte Profile nach `/store/actors/~<pub>/profile`. `createAttestation()`/`resolveMainUser()` verknüpfen Space- mit Main-Identität privat. Der `pub` (base64url Ed25519-Public-Key) ist bereits heute die globale Actor-Adresse im gesamten System.

**Bestätigt: kein ActivityPub-/Federation-Code oder -Doku in QuV3** — vollständiges Greenfield für alles AP-Spezifische.

**Wichtige AP-Fakten, die den obigen Plan begründen:** AP standardisiert nur Server-zu-Server-Föderation (Inbox/Outbox, HTTP-Signatures) — es gibt keine standardisierte Client-zu-Server-API (Mastodon/Lemmy haben je eigene, inkompatible REST-APIs); ein Browser-Client kann keine eigene Inbox öffentlich empfangen und braucht daher einen Server (QuRelay) als Actor-Host. Realtime-Zustellung an eingeloggte Clients ist in AP selbst nicht spezifiziert — Mastodon löst das mit einer proprietären WebSocket-Streaming-API zusätzlich zur S2S-Föderation; genau dieses Muster übernimmt `packages/ap-realtime` in diesem Plan. Mastodon verifiziert eingehende Föderation über HTTP-Signatures mit RSA-SHA256 und erwartet `publicKey.publicKeyPem` — daher die Entscheidung für ein zusätzliches, wegwerfbares RSA-Transport-Keypair neben dem Ed25519-Identitäts-Key.
