import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export const app = new Hono();
const COLOMBIA_BBOX = "-79,-4,-66,13";
const SOURCES = new Set(["VIIRS_NOAA20_NRT", "VIIRS_NOAA21_NRT", "VIIRS_SNPP_NRT", "MODIS_NRT", "VIIRS_NOAA20_SP"]);
const supabase = process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY) : null;
type AlertStatus = "new" | "acknowledged" | "dispatched" | "resolved";
type OperationAlert = { id: string; external_key: string; observed_at: string; latitude: number; longitude: number; frp: number; intensity: number; sensors: string; level: string; status: AlertStatus; ideam_notification_status: string; ideam_notified_at: string | null; created_at: string; updated_at: string };
const memoryAlerts = new Map<string, OperationAlert>();
type DepartmentFeature = { properties: { NAME_1?: string }; geometry: { type: string; coordinates: unknown } };
let departments: DepartmentFeature[] = [];
try { departments = (JSON.parse(readFileSync(resolve(process.cwd(), "sentinel_data/gadm41_COL_1.json"), "utf8")) as { features: DepartmentFeature[] }).features; } catch { departments = []; }
function pointInRing(lon: number, lat: number, ring: number[][]) { let inside = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i], [xj, yj] = ring[j]; if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside; } return inside; }
function departmentFor(latitude: number, longitude: number) { for (const feature of departments) { const geometry = feature.geometry; const polygons = geometry.type === "Polygon" ? [geometry.coordinates as number[][][]] : geometry.type === "MultiPolygon" ? geometry.coordinates as number[][][][] : []; if (polygons.some(polygon => pointInRing(longitude, latitude, polygon[0]))) return feature.properties.NAME_1 ?? "Colombia"; } return "Outside departmental boundary"; }
const withDepartment = (alert: OperationAlert) => ({ ...alert, department: departmentFor(alert.latitude, alert.longitude) });
type Fire = { latitude: number; longitude: number; frp: number | null; confidence: string; observedAt: string; satellite: string; instrument: string; source: string };

function rows(csv: string) { const [head, ...lines] = csv.trim().split(/\r?\n/); const keys = head?.split(",").map(v => v.trim()) ?? []; return lines.filter(Boolean).map(line => Object.fromEntries(keys.map((key, i) => [key, line.split(",")[i]?.trim() ?? ""]))); }
function parse(row: Record<string, string>, source: string): Fire | null { const latitude = Number(row.latitude), longitude = Number(row.longitude); if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null; const time = (row.acq_time || "0000").padStart(4, "0"); const rawConfidence = (row.confidence || "nominal").toLowerCase(); const confidence = rawConfidence === "h" ? "high" : rawConfidence === "l" ? "low" : rawConfidence === "n" ? "nominal" : rawConfidence; return { latitude, longitude, frp: Number.isFinite(Number(row.frp)) ? Number(row.frp) : null, confidence, observedAt: `${row.acq_date}T${time.slice(0,2)}:${time.slice(2)}:00Z`, satellite: row.satellite || "", instrument: row.instrument || "", source }; }

type MapLayer = "combined" | "viirs" | "modis";
type RawFire = Fire & { scan: number; track: number; confidenceScore: number };
type HarmonizedFire = Fire & { layer: MapLayer; sensors: string; pixelCount: number; intensity: number; level: "critical" | "moderate" | "watch" };
const scoreForConfidence = (value: string) => value === "high" ? 90 : value === "low" ? 30 : 65;
const toRadians = (value: number) => value * Math.PI / 180;
const distanceKm = (a: Fire, b: Fire) => { const dLat = toRadians(b.latitude - a.latitude), dLon = toRadians(b.longitude - a.longitude); const x = Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(a.latitude)) * Math.cos(toRadians(b.latitude)) * Math.sin(dLon / 2) ** 2; return 6371 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x)); };
const observedMs = (fire: Fire) => Date.parse(fire.observedAt);
function rawFire(row: Record<string, string>, source: string): RawFire | null { const fire = parse(row, source); if (!fire) return null; const scan = Math.max(.1, Number(row.scan) || 1), track = Math.max(.1, Number(row.track) || 1); return { ...fire, scan, track, confidenceScore: scoreForConfidence(fire.confidence) }; }
async function fetchFirms(source: string, days: number, date?: string) {
  const key = process.env.FIRMS_MAP_KEY; if (!key) throw new Error("FIRMS_MAP_KEY no está configurada en .env.local");
  const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${encodeURIComponent(key)}/${source}/${COLOMBIA_BBOX}/${days}${date ? `/${date}` : ""}`;
  const response = await fetch(url, { headers: { Accept: "text/csv" } }); const body = await response.text();
  if (!response.ok) throw new Error(`NASA FIRMS respondió ${response.status}: ${body.slice(0, 140)}`);
  return rows(body).map(row => rawFire(row, source)).filter((fire): fire is RawFire => fire !== null);
}
function harmonize(points: RawFire[]): HarmonizedFire[] {
  const parent = points.map((_, index) => index); const find = (index: number): number => parent[index] === index ? index : (parent[index] = find(parent[index])); const join = (a: number, b: number) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[rb] = ra; };
  for (let a = 0; a < points.length; a++) for (let b = a + 1; b < points.length; b++) { const timeGapMinutes = Math.abs(observedMs(points[a]) - observedMs(points[b])) / 60000; const radiusA = .5 * Math.hypot(points[a].scan, points[a].track), radiusB = .5 * Math.hypot(points[b].scan, points[b].track); if (timeGapMinutes <= 30 && distanceKm(points[a], points[b]) <= radiusA + radiusB + .6) join(a, b); }
  const groups = new Map<number, RawFire[]>(); points.forEach((point, index) => { const key = find(index); groups.set(key, [...(groups.get(key) ?? []), point]); });
  return [...groups.values()].map(group => { const weights = group.map(point => ((point.frp ?? .5) * point.confidenceScore) / Math.max(.1, (point.scan * point.track) ** 2)); const totalWeight = weights.reduce((sum, weight) => sum + weight, 0); const frp = group.reduce((sum, point) => sum + (point.frp ?? 0), 0); const area = Math.min(...group.map(point => point.scan * point.track)); const intensity = frp / Math.max(.14, area); const sensors = [...new Set(group.map(point => point.source.includes("MODIS") ? "MODIS" : "VIIRS"))].sort().join("+"); const level = sensors === "MODIS+VIIRS" || intensity >= 80 ? "critical" : Math.max(...group.map(point => point.confidenceScore)) >= 65 ? "moderate" : "watch"; return { latitude: group.reduce((sum, point, index) => sum + point.latitude * weights[index], 0) / totalWeight, longitude: group.reduce((sum, point, index) => sum + point.longitude * weights[index], 0) / totalWeight, frp: Math.round(frp * 100) / 100, confidence: level === "critical" ? "high" : level === "moderate" ? "nominal" : "low", observedAt: group.map(point => point.observedAt).sort()[0], satellite: "Fusión FIRMS", instrument: "MODIS + VIIRS", source: "COMBINED", layer: "combined", sensors, pixelCount: group.length, intensity: Math.round(intensity * 100) / 100, level }; });
}

app.get("/api/health", c => c.json({ ok: true, firmsConfigured: Boolean(process.env.FIRMS_MAP_KEY) }));
app.get("/api/fires", async c => {
  const key = process.env.FIRMS_MAP_KEY;
  if (!key) return c.json({ error: "FIRMS_MAP_KEY no está configurada en .env.local" }, 503);
  const requested = Number(c.req.query("days") ?? "1"); const days = Number.isInteger(requested) ? Math.min(5, Math.max(1, requested)) : 1;
  const source = c.req.query("source") ?? "VIIRS_NOAA20_NRT"; const date = c.req.query("date");
  if (!SOURCES.has(source)) return c.json({ error: "Fuente FIRMS no permitida" }, 400);
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return c.json({ error: "date debe tener formato YYYY-MM-DD" }, 400);
  const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${encodeURIComponent(key)}/${source}/${COLOMBIA_BBOX}/${days}${date ? `/${date}` : ""}`;
  try { const response = await fetch(url, { headers: { Accept: "text/csv" } }); const body = await response.text(); if (!response.ok) return c.json({ error: "NASA FIRMS no respondió correctamente", detail: body.slice(0, 180) }, 502); const data = rows(body).map(row => parse(row, source)).filter((fire): fire is Fire => fire !== null); return c.json({ data, meta: { source, days, date: date ?? null, bbox: COLOMBIA_BBOX, count: data.length } }, 200, { "Cache-Control": "public, max-age=300" }); } catch { return c.json({ error: "No fue posible conectar con NASA FIRMS" }, 502); }
});
app.get("/api/fires/layers", async c => {
  const layer = (c.req.query("layer") ?? "combined") as MapLayer; const requested = Number(c.req.query("days") ?? "1"); const days = Number.isInteger(requested) ? Math.min(5, Math.max(1, requested)) : 1; const date = c.req.query("date");
  if (!["combined", "viirs", "modis"].includes(layer)) return c.json({ error: "layer debe ser combined, viirs o modis" }, 400);
  try { const [viirs, modis] = await Promise.all([fetchFirms("VIIRS_NOAA20_NRT", days, date), fetchFirms("MODIS_NRT", days, date)]); const data: HarmonizedFire[] = layer === "combined" ? harmonize([...viirs, ...modis]) : (layer === "viirs" ? viirs : modis).map(point => ({ ...point, layer, sensors: layer.toUpperCase(), pixelCount: 1, intensity: Math.round(((point.frp ?? 0) / Math.max(.14, point.scan * point.track)) * 100) / 100, level: point.confidence === "high" ? "critical" : point.confidence === "nominal" ? "moderate" : "watch" })); return c.json({ data, meta: { layer, days, date: date ?? null, count: data.length, sources: layer === "combined" ? ["VIIRS_NOAA20_NRT", "MODIS_NRT"] : [layer === "viirs" ? "VIIRS_NOAA20_NRT" : "MODIS_NRT"], harmonized: layer === "combined" } }, 200, { "Cache-Control": "public, max-age=300" }); } catch (error) { return c.json({ error: error instanceof Error ? error.message : "No fue posible consultar NASA FIRMS" }, 502); }
});
async function listOperationAlerts() {
  if (!supabase) return [...memoryAlerts.values()].sort((a, b) => b.observed_at.localeCompare(a.observed_at)).map(withDepartment);
  const { data, error } = await supabase.from("operation_alerts").select("*").order("observed_at", { ascending: false }).limit(100);
  if (error) throw error;
  return (data as OperationAlert[]).map(withDepartment);
}
async function saveOperationAlert(alert: Omit<OperationAlert, "id" | "created_at" | "updated_at">) {
  if (!supabase) { const existing = memoryAlerts.get(alert.external_key); const stored: OperationAlert = { ...alert, id: existing?.id ?? crypto.randomUUID(), created_at: existing?.created_at ?? new Date().toISOString(), updated_at: new Date().toISOString() }; memoryAlerts.set(alert.external_key, stored); return stored; }
  const { data, error } = await supabase.from("operation_alerts").upsert(alert, { onConflict: "external_key" }).select().single();
  if (error) throw error;
  return data as OperationAlert;
}
async function updateOperationAlert(id: string, patch: Partial<Pick<OperationAlert, "status" | "ideam_notification_status" | "ideam_notified_at">>) {
  if (!supabase) { const current = [...memoryAlerts.values()].find(item => item.id === id); if (!current) return null; const updated = { ...current, ...patch, updated_at: new Date().toISOString() }; memoryAlerts.set(updated.external_key, updated); return updated; }
  const { data, error } = await supabase.from("operation_alerts").update(patch).eq("id", id).select().maybeSingle();
  if (error) throw error;
  return data as OperationAlert | null;
}
async function notifyIdeam(alert: OperationAlert) {
  const email = process.env.IDEAM_ALERT_EMAIL, apiKey = process.env.RESEND_API_KEY, from = process.env.ALERT_FROM_EMAIL;
  if (!email || !apiKey || !from) return updateOperationAlert(alert.id, { ideam_notification_status: "pending_configuration" });
  const response = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ from, to: [email], subject: `[Sentinel Ember] Critical wildfire alert`, text: `Critical harmonized wildfire alert\nUTC: ${alert.observed_at}\nCoordinates: ${alert.latitude}, ${alert.longitude}\nFRP: ${alert.frp} MW\nIntensity: ${alert.intensity} MW/km²\nSensors: ${alert.sensors}` }) });
  return updateOperationAlert(alert.id, response.ok ? { ideam_notification_status: "sent", ideam_notified_at: new Date().toISOString() } : { ideam_notification_status: "failed" });
}
app.get("/api/alerts", async c => { try { return c.json({ data: await listOperationAlerts(), configured: Boolean(supabase) }); } catch (error) { return c.json({ error: error instanceof Error ? error.message : "Could not load alerts" }, 500); } });
app.on(["GET", "POST"], "/api/alerts/refresh", async c => {
  const expectedSecret = process.env.CRON_SECRET;
  const authorization = c.req.header("authorization");
  if (expectedSecret && authorization !== `Bearer ${expectedSecret}`) return c.json({ error: "Unauthorized" }, 401);
  try {
    const [viirs, modis] = await Promise.all([fetchFirms("VIIRS_NOAA20_NRT", 5), fetchFirms("MODIS_NRT", 5)]);
    const actionable = harmonize([...viirs, ...modis]).filter(fire => fire.level === "critical" || fire.level === "moderate");
    const saved = [];
    for (const fire of actionable) {
      const external_key = `${fire.observedAt}-${fire.latitude.toFixed(3)}-${fire.longitude.toFixed(3)}-${fire.sensors}`;
      const prior = (await listOperationAlerts()).find(item => item.external_key === external_key);
      const alert = await saveOperationAlert({ external_key, observed_at: fire.observedAt, latitude: fire.latitude, longitude: fire.longitude, frp: fire.frp ?? 0, intensity: fire.intensity, sensors: fire.sensors, level: fire.level, status: prior?.status ?? "new", ideam_notification_status: prior?.ideam_notification_status ?? "pending_configuration", ideam_notified_at: prior?.ideam_notified_at ?? null });
      if (fire.level === "critical" && (!prior || ["pending_configuration", "failed"].includes(alert.ideam_notification_status))) await notifyIdeam(alert);
      saved.push(alert);
    }
    return c.json({ data: await listOperationAlerts(), detected: saved.length });
  } catch (error) { return c.json({ error: error instanceof Error ? error.message : "Could not refresh alerts" }, 502); }
});
app.post("/api/alerts/:id/status", async c => { const status = (await c.req.json().catch(() => ({}))).status as AlertStatus; if (!(["new", "acknowledged", "dispatched", "resolved"] as string[]).includes(status)) return c.json({ error: "Invalid status" }, 400); const alert = await updateOperationAlert(c.req.param("id"), { status }); return alert ? c.json({ data: alert }) : c.json({ error: "Alert not found" }, 404); });
if (!process.env.VERCEL) serve({ fetch: app.fetch, port: 8787, hostname: "127.0.0.1" }, info => console.log(`API disponible en http://127.0.0.1:${info.port}`));
