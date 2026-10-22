"use client";

import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { Camera, ChevronRight, Download, LogOut, Users, LayoutGrid, FileText, MapPin, X, CreditCard, Banknote, Check, Menu, Search } from "lucide-react";
import { supabase, usernameToEmail } from "../lib/supabaseClient";

const LOCATIONS = ["Radisson", "Harbour", "Five Hotels", "Balloon Flights", "Drive the Thrill"];

const ink = "#142420";
const paper = "#EFEAE1";
const gold = "#C89B3C";
const coral = "#BE5A3E";
const teal = "#2F6F63";
const inkSoft = "#4B5B55";
const cardBorder = "#DCD5C6";

// Where each sale came from
const SOURCES = [
  { value: "prepaid", label: "Prepaid" },
  { value: "walk_in", label: "Walk in" },
  { value: "sales_team", label: "Sales team" },
];
function sourceLabel(v) {
  const f = SOURCES.find((s) => s.value === v);
  return f ? f.label : "Not set";
}

// Pricing rules used by the commission report
const VAT_RATE = 0.05; // customer prices include 5% VAT
const CC_RATE = 0.0325; // card processing charge, applied to card sales only

function fmtAED(n) {
  return "AED " + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtDate(iso) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}
function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

// Tries to pull an authorization/approval code out of raw OCR text from a card slip.
// Looks for common labels used on POS receipts. Not guaranteed to find it — OCR
// misreads happen, especially on thermal-printed slips or blurry photos.
function extractAuthCode(text) {
  if (!text) return "";
  const patterns = [
    /AUTH(?:ORIZATION)?\s*(?:CODE)?[:#\s]*(?=[A-Z0-9]{0,7}\d)([A-Z0-9]{4,8})/i,
    /APPR(?:OVAL)?\s*(?:CODE)?[:#\s]*(?=[A-Z0-9]{0,7}\d)([A-Z0-9]{4,8})/i,
    /APP\s*CODE[:#\s]*(?=[A-Z0-9]{0,7}\d)([A-Z0-9]{4,8})/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m && m[1]) return m[1].toUpperCase();
  }
  return "";
}

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

async function downloadSlip(sale) {
  const { data, error } = await supabase.storage.from("card-photos").download(sale.card_photo_path);
  if (error || !data) {
    alert("Could not download slip: " + (error ? error.message : "unknown error"));
    return;
  }
  saveBlob(data, `${sale.ref_number || "slip"}.jpg`);
}

// gross = what customers paid (incl. VAT)
// exVat = gross / 1.05, vat = gross - exVat
// cc = 3.25% of card sales, net = gross - (cc + vat)
function calcBreakdown(rows) {
  const gross = rows.reduce((sum, s) => sum + Number(s.amount), 0);
  const cardGross = rows.filter((s) => s.method === "card").reduce((sum, s) => sum + Number(s.amount), 0);
  const exVat = gross / (1 + VAT_RATE);
  const vat = gross - exVat;
  const cc = cardGross * CC_RATE;
  const net = gross - (cc + vat);
  return { gross, cardGross, exVat, vat, cc, net };
}

function useIsMobile(breakpoint = 780) {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    function check() {
      setIsMobile(window.innerWidth <= breakpoint);
    }
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, [breakpoint]);
  return isMobile;
}

export default function Home() {
  const [session, setSession] = useState(undefined);
  const [profile, setProfile] = useState(null);
  const [sales, setSales] = useState([]);
  const [view, setView] = useState("dashboard");
  const [activeLocation, setActiveLocation] = useState(LOCATIONS[0]);
  const [showLogModal, setShowLogModal] = useState(false);
  const [manage, setManage] = useState(null); // { sale, mode } when the manager edits or voids a bill
  const [changeTick, setChangeTick] = useState(0);
  const [adminLocs, setAdminLocs] = useState(null); // locations an admin oversees (null while loading)
  const isMobile = useIsMobile();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => setSession(sess));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) {
      setProfile(null);
      return;
    }
    supabase
      .from("profiles")
      .select("*")
      .eq("id", session.user.id)
      .single()
      .then(({ data }) => {
        setProfile(data);
        if (data) {
          setView(data.role === "staff" ? "location" : "dashboard");
          if (data.role === "staff" && data.location) setActiveLocation(data.location);
        }
      });
  }, [session]);

  useEffect(() => {
    if (!profile || profile.role !== "admin") {
      setAdminLocs([]);
      return;
    }
    supabase
      .from("admin_locations")
      .select("location")
      .eq("username", profile.username)
      .then(({ data }) => {
        const set = new Set((data || []).map((r) => r.location));
        const mine = LOCATIONS.filter((l) => set.has(l));
        setAdminLocs(mine);
        if (mine.length > 0) setActiveLocation((cur) => (mine.includes(cur) ? cur : mine[0]));
      });
  }, [profile]);

  const loadSales = useCallback(async () => {
    // The database returns at most 1,000 rows per request, so read in pages until all sales are loaded.
    const pageSize = 1000;
    let all = [];
    for (let start = 0; ; start += pageSize) {
      const { data, error } = await supabase
        .from("sales")
        .select("*")
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(start, start + pageSize - 1);
      if (error) return;
      all = all.concat(data || []);
      if (!data || data.length < pageSize) break;
    }
    setSales(all);
  }, []);

  useEffect(() => {
    if (profile) loadSales();
  }, [profile, loadSales]);

  async function addSale(entry) {
    const { data, error } = await supabase.from("sales").insert(entry).select().single();
    if (error) {
      alert("Could not save sale: " + error.message);
      return null;
    }
    loadSales();
    return data;
  }

  if (session === undefined) return <FullscreenMsg text="Loading..." />;
  if (!session || !profile) return <Login onSignedIn={() => {}} />;

  // Voided bills stay in the lists but never count in totals, card charges or commission.
  const liveSales = sales.filter((s) => !s.voided_at);
  // The manager sees every location. An admin has the manager's powers, but only for the locations assigned to them.
  const canManage = profile.role === "manager" || profile.role === "admin";
  const myLocations = profile.role === "manager" ? LOCATIONS : profile.role === "admin" ? adminLocs || [] : [profile.location].filter(Boolean);
  const noScope = profile.role === "admin" && Array.isArray(adminLocs) && adminLocs.length === 0;
  const onManage = canManage ? (sale, mode) => setManage({ sale, mode }) : null;

  return (
    <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", minHeight: "100vh", background: paper, fontFamily: "Inter, sans-serif", color: ink }}>
      <Sidebar
        profile={profile}
        myLocations={myLocations}
        canManage={canManage}
        view={view}
        setView={setView}
        activeLocation={activeLocation}
        setActiveLocation={setActiveLocation}
        onSignOut={() => supabase.auth.signOut()}
        isMobile={isMobile}
      />
      <main style={{ flex: 1, padding: isMobile ? "20px 16px 90px" : "40px 44px", minWidth: 0 }}>
        {noScope && (
          <div style={{ background: "#fff", border: `1px solid ${cardBorder}`, borderRadius: 4, padding: "22px 20px", fontSize: 14, color: inkSoft, lineHeight: 1.5 }}>
            No locations are assigned to your admin account yet. Ask the manager to tick your locations on the Staff page.
          </div>
        )}
        {!noScope && view === "dashboard" && canManage && (
          <Dashboard sales={liveSales} locations={myLocations} onOpenLocation={(loc) => { setActiveLocation(loc); setView("location"); }} isMobile={isMobile} />
        )}
        {!noScope && view === "location" && (
          <LocationView location={activeLocation} sales={liveSales} allSales={sales} profile={profile} onLogSale={() => setShowLogModal(true)} onManage={onManage} isMobile={isMobile} />
        )}
        {!noScope && view === "reports" && canManage && <Reports sales={liveSales} allSales={sales} locations={myLocations} onManage={onManage} changeTick={changeTick} isMobile={isMobile} />}
        {!noScope && view === "staff" && canManage && <StaffView sales={liveSales} profile={profile} locations={myLocations} isMobile={isMobile} />}
      </main>
      {showLogModal && (
        <LogSaleModal
          location={activeLocation}
          profile={profile}
          isMobile={isMobile}
          onClose={() => setShowLogModal(false)}
          onSubmit={async (entry) => addSale(entry)}
        />
      )}
      {manage && (
        <ManageSaleModal
          sale={manage.sale}
          mode={manage.mode}
          profile={profile}
          locations={myLocations}
          isMobile={isMobile}
          onClose={() => setManage(null)}
          onDone={() => { setManage(null); setChangeTick((n) => n + 1); loadSales(); }}
        />
      )}
    </div>
  );
}

function FullscreenMsg({ text }) {
  return (
    <div style={{ minHeight: "100vh", background: ink, display: "flex", alignItems: "center", justifyContent: "center", color: paper, fontFamily: "Inter, sans-serif" }}>
      {text}
    </div>
  );
}

function Login() {
  const [mode, setMode] = useState("signin");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [location, setLocation] = useState(LOCATIONS[0]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function switchMode(m) {
    setMode(m);
    setError("");
  }

  async function handleSignIn() {
    setBusy(true);
    setError("");
    const { error } = await supabase.auth.signInWithPassword({
      email: usernameToEmail(username),
      password,
    });
    if (error) setError("Wrong username or password.");
    setBusy(false);
  }

  async function handleSignUp() {
    setBusy(true);
    setError("");
    const { data, error } = await supabase.auth.signUp({
      email: usernameToEmail(username),
      password,
    });
    if (error) {
      setError(error.message);
      setBusy(false);
      return;
    }
    if (data.user) {
      await supabase.from("profiles").update({ location }).eq("id", data.user.id);
    }
    setBusy(false);
  }

  return (
    <div style={{ minHeight: "100vh", background: ink, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Inter, sans-serif", padding: 16 }}>
      <div style={{ width: "100%", maxWidth: 380, background: paper, borderRadius: 4, padding: "40px 32px", border: `1px solid ${cardBorder}`, boxSizing: "border-box" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 6 }}>
          <span style={{ fontFamily: "Fraunces, serif", fontSize: 26, fontWeight: 600, color: ink }}>Shutter</span>
          <span style={{ fontFamily: "Fraunces, serif", fontSize: 26, fontWeight: 300, color: gold, fontStyle: "italic" }}>Ledger</span>
        </div>
        <p style={{ color: inkSoft, fontSize: 13.5, marginBottom: 24, lineHeight: 1.5 }}>Photo sales, tracked by location.</p>

        <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
          <button onClick={() => switchMode("signin")} style={tabStyle(mode === "signin")}>Sign in</button>
          <button onClick={() => switchMode("signup")} style={tabStyle(mode === "signup")}>New staff account</button>
        </div>

        <label style={labelStyle}>Username</label>
        <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="e.g. chalaka" style={inputStyle} />

        <label style={labelStyle}>Password</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} style={{ ...inputStyle, marginBottom: mode === "signup" ? 18 : 22 }} />

        {mode === "signup" && (
          <>
            <label style={labelStyle}>Your location</label>
            <select value={location} onChange={(e) => setLocation(e.target.value)} style={{ ...inputStyle, marginBottom: 22 }}>
              {LOCATIONS.map((l) => (
                <option key={l} value={l}>{l}</option>
              ))}
            </select>
          </>
        )}

        {error && <div style={{ color: coral, fontSize: 12.5, marginBottom: 14 }}>{error}</div>}

        <button
          disabled={!username.trim() || !password || busy}
          onClick={mode === "signin" ? handleSignIn : handleSignUp}
          style={{
            width: "100%",
            padding: "12px 0",
            borderRadius: 3,
            border: "none",
            background: username.trim() && password && !busy ? gold : "#CFC6AE",
            color: ink,
            fontWeight: 600,
            fontSize: 14,
            cursor: username.trim() && password && !busy ? "pointer" : "not-allowed",
          }}
        >
          {busy ? "Please wait..." : mode === "signin" ? "Sign in" : "Create account"}
        </button>

        {mode === "signup" && (
          <p style={{ fontSize: 11.5, color: inkSoft, marginTop: 14, lineHeight: 1.5 }}>
            New accounts start as staff for the location you pick. A manager can promote or reassign you later.
          </p>
        )}
      </div>
    </div>
  );
}

const labelStyle = { fontSize: 12, color: inkSoft, display: "block", marginBottom: 5 };
const inputStyle = { width: "100%", padding: "11px 12px", borderRadius: 3, border: `1px solid ${cardBorder}`, marginBottom: 16, fontSize: 15, background: "#fff", boxSizing: "border-box" };
function tabStyle(active) {
  return {
    flex: 1,
    padding: "10px 0",
    fontSize: 12.5,
    borderRadius: 3,
    border: `1px solid ${active ? ink : cardBorder}`,
    background: active ? ink : "transparent",
    color: active ? paper : inkSoft,
    cursor: "pointer",
  };
}

function Sidebar({ profile, myLocations, canManage, view, setView, activeLocation, setActiveLocation, onSignOut, isMobile }) {
  const [menuOpen, setMenuOpen] = useState(false);

  const navItemStyle = (active, mobileStyle) => ({
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: mobileStyle ? "13px 16px" : "9px 14px",
    borderRadius: 3,
    fontSize: mobileStyle ? 15 : 13.5,
    color: active ? paper : "#9FAEA8",
    background: active ? "rgba(200,155,60,0.16)" : "transparent",
    borderLeft: active ? `2px solid ${gold}` : "2px solid transparent",
    cursor: "pointer",
    marginBottom: 2,
  });

  const locations = myLocations;

  function go(setter, val, closeMenu) {
    setter(val);
    if (closeMenu) setMenuOpen(false);
  }

  if (isMobile) {
    return (
      <>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: ink, padding: "14px 16px" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
            <span style={{ fontFamily: "Fraunces, serif", fontSize: 17, fontWeight: 600, color: paper }}>Shutter</span>
            <span style={{ fontFamily: "Fraunces, serif", fontSize: 17, fontWeight: 300, fontStyle: "italic", color: gold }}>Ledger</span>
          </div>
          <div onClick={() => setMenuOpen(true)} style={{ color: paper, cursor: "pointer", padding: 4 }}>
            <Menu size={22} />
          </div>
        </div>
        {menuOpen && (
          <div style={{ position: "fixed", inset: 0, background: ink, zIndex: 60, padding: "18px 16px", overflowY: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
              <div style={{ color: paper, fontSize: 14, fontWeight: 600 }}>{profile.username}</div>
              <X size={22} color={paper} onClick={() => setMenuOpen(false)} />
            </div>

            {canManage && (
              <div onClick={() => go(setView, "dashboard", true)} style={navItemStyle(view === "dashboard", true)}>
                <LayoutGrid size={16} /> Dashboard
              </div>
            )}

            <div style={{ marginTop: 12, marginBottom: 4, padding: "0 16px", fontSize: 11, color: "#6E7D77" }}>Locations</div>
            {locations.filter(Boolean).map((loc) => (
              <div key={loc} onClick={() => { go(setActiveLocation, loc); go(setView, "location", true); }} style={navItemStyle(view === "location" && activeLocation === loc, true)}>
                <MapPin size={16} /> {loc}
              </div>
            ))}

            {canManage && (
              <>
                <div style={{ marginTop: 12, marginBottom: 4, padding: "0 16px", fontSize: 11, color: "#6E7D77" }}>Manage</div>
                <div onClick={() => go(setView, "reports", true)} style={navItemStyle(view === "reports", true)}>
                  <FileText size={16} /> Reports
                </div>
                <div onClick={() => go(setView, "staff", true)} style={navItemStyle(view === "staff", true)}>
                  <Users size={16} /> Staff
                </div>
              </>
            )}

            <div onClick={onSignOut} style={{ display: "flex", alignItems: "center", gap: 8, padding: "14px 16px", color: "#9FAEA8", fontSize: 14, cursor: "pointer", marginTop: 20, borderTop: "1px solid rgba(255,255,255,0.08)" }}>
              <LogOut size={15} /> Sign out
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <aside style={{ width: 220, background: ink, padding: "26px 16px", display: "flex", flexDirection: "column", flexShrink: 0 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6, padding: "0 6px", marginBottom: 30 }}>
        <span style={{ fontFamily: "Fraunces, serif", fontSize: 18, fontWeight: 600, color: paper }}>Shutter</span>
        <span style={{ fontFamily: "Fraunces, serif", fontSize: 18, fontWeight: 300, fontStyle: "italic", color: gold }}>Ledger</span>
      </div>

      {canManage && (
        <div onClick={() => setView("dashboard")} style={navItemStyle(view === "dashboard")}>
          <LayoutGrid size={15} /> Dashboard
        </div>
      )}

      <div style={{ marginTop: 10, marginBottom: 4, padding: "0 14px", fontSize: 11, color: "#6E7D77" }}>Locations</div>
      {locations.filter(Boolean).map((loc) => (
        <div key={loc} onClick={() => { setActiveLocation(loc); setView("location"); }} style={navItemStyle(view === "location" && activeLocation === loc)}>
          <MapPin size={15} /> {loc}
        </div>
      ))}

      {canManage && (
        <>
          <div style={{ marginTop: 14, marginBottom: 4, padding: "0 14px", fontSize: 11, color: "#6E7D77" }}>Manage</div>
          <div onClick={() => setView("reports")} style={navItemStyle(view === "reports")}>
            <FileText size={15} /> Reports
          </div>
          <div onClick={() => setView("staff")} style={navItemStyle(view === "staff")}>
            <Users size={15} /> Staff
          </div>
        </>
      )}

      <div style={{ marginTop: "auto", paddingTop: 20, borderTop: "1px solid rgba(255,255,255,0.08)" }}>
        <div style={{ padding: "0 6px", marginBottom: 10 }}>
          <div style={{ color: paper, fontSize: 13.5, fontWeight: 600 }}>{profile.username}</div>
          <div style={{ color: "#8A9891", fontSize: 12 }}>{profile.role === "manager" ? "Manager · all locations" : profile.role === "admin" ? "Admin · " + (myLocations.join(", ") || "no locations yet") : profile.location}</div>
        </div>
        <div onClick={onSignOut} style={{ display: "flex", alignItems: "center", gap: 8, padding: 6, color: "#9FAEA8", fontSize: 12.5, cursor: "pointer" }}>
          <LogOut size={13} /> Sign out
        </div>
      </div>
    </aside>
  );
}

function StatCard({ label, value, tint }) {
  return (
    <div style={{ background: "#fff", border: `1px solid ${cardBorder}`, borderRadius: 4, padding: "16px 18px", flex: "1 1 150px", minWidth: 140 }}>
      <div style={{ fontSize: 12, color: inkSoft, marginBottom: 8 }}>{label}</div>
      <div style={{ fontFamily: "Fraunces, serif", fontSize: 24, fontWeight: 600, color: tint || ink }}>{value}</div>
    </div>
  );
}

function Dashboard({ sales, locations, onOpenLocation, isMobile }) {
  const totals = useMemo(() => {
    const byLoc = {};
    locations.forEach((l) => (byLoc[l] = { cash: 0, card: 0, count: 0 }));
    sales.forEach((s) => {
      if (!byLoc[s.location]) return;
      byLoc[s.location][s.method] += Number(s.amount);
      byLoc[s.location].count += 1;
    });
    return byLoc;
  }, [sales, locations]);

  const grandTotal = sales.reduce((sum, s) => sum + Number(s.amount), 0);
  const cashTotal = sales.filter((s) => s.method === "cash").reduce((sum, s) => sum + Number(s.amount), 0);
  const cardTotal = sales.filter((s) => s.method === "card").reduce((sum, s) => sum + Number(s.amount), 0);
  const maxVal = Math.max(1, ...locations.map((l) => totals[l].cash + totals[l].card));

  return (
    <div>
      <h1 style={{ fontFamily: "Fraunces, serif", fontSize: isMobile ? 22 : 28, fontWeight: 600, margin: 0 }}>Dashboard</h1>
      <p style={{ color: inkSoft, fontSize: 13.5, marginTop: 4, marginBottom: 22 }}>Photo sales across all locations, live.</p>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 24 }}>
        <StatCard label="Total sales" value={fmtAED(grandTotal)} />
        <StatCard label="Cash collected" value={fmtAED(cashTotal)} tint={teal} />
        <StatCard label="Card collected" value={fmtAED(cardTotal)} tint={coral} />
        <StatCard label="Entries logged" value={sales.length} />
      </div>

      <div style={{ background: "#fff", border: `1px solid ${cardBorder}`, borderRadius: 4, padding: isMobile ? "18px 14px" : "20px 22px", marginBottom: 20, overflowX: "auto" }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 18 }}>Sales by location</div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: isMobile ? 24 : 40, height: 160, paddingLeft: 4, minWidth: isMobile ? 470 : "auto" }}>
          {locations.map((loc) => {
            const t = totals[loc];
            const h = ((t.cash + t.card) / maxVal) * 140;
            return (
              <div key={loc} style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 70 }}>
                <div style={{ fontSize: 11.5, color: inkSoft, marginBottom: 6 }}>{fmtAED(t.cash + t.card)}</div>
                <div style={{ width: 46, height: Math.max(h, 2), display: "flex", flexDirection: "column-reverse", borderRadius: "2px 2px 0 0", overflow: "hidden" }}>
                  <div style={{ height: `${t.card ? (t.card / (t.cash + t.card || 1)) * 100 : 0}%`, background: coral }} />
                  <div style={{ flex: 1, background: teal }} />
                </div>
                <div style={{ fontSize: 12.5, marginTop: 8, textAlign: "center" }}>{loc}</div>
              </div>
            );
          })}
        </div>
        <div style={{ display: "flex", gap: 18, marginTop: 16, fontSize: 12, color: inkSoft }}>
          <span><span style={{ display: "inline-block", width: 9, height: 9, background: teal, borderRadius: 2, marginRight: 6 }} />Cash</span>
          <span><span style={{ display: "inline-block", width: 9, height: 9, background: coral, borderRadius: 2, marginRight: 6 }} />Card</span>
        </div>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
        {locations.map((loc) => (
          <div key={loc} onClick={() => onOpenLocation(loc)} style={{ flex: "1 1 200px", background: "#fff", border: `1px solid ${cardBorder}`, borderRadius: 4, padding: "16px 18px", cursor: "pointer" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{loc}</div>
              <ChevronRight size={15} color={inkSoft} />
            </div>
            <div style={{ fontFamily: "Fraunces, serif", fontSize: 20, marginTop: 8 }}>{fmtAED(totals[loc].cash + totals[loc].card)}</div>
            <div style={{ fontSize: 12, color: inkSoft, marginTop: 2 }}>{totals[loc].count} sales logged</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function LocationView({ location, sales, allSales, profile, onLogSale, onManage, isMobile }) {
  const entries = sales.filter((s) => s.location === location);
  const listEntries = (allSales || sales).filter((s) => s.location === location);
  const total = entries.reduce((sum, s) => sum + Number(s.amount), 0);
  const cash = entries.filter((s) => s.method === "cash").reduce((sum, s) => sum + Number(s.amount), 0);
  const card = entries.filter((s) => s.method === "card").reduce((sum, s) => sum + Number(s.amount), 0);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [previewSale, setPreviewSale] = useState(null);
  const [thumbs, setThumbs] = useState({});

  useEffect(() => {
    const paths = listEntries.filter((e) => e.card_photo_path).map((e) => e.card_photo_path);
    if (paths.length === 0) return;
    let cancelled = false;
    (async () => {
      const next = {};
      for (const path of paths) {
        if (thumbs[path]) continue;
        const { data } = await supabase.storage.from("card-photos").createSignedUrl(path, 3600);
        if (data) next[path] = data.signedUrl;
      }
      if (!cancelled && Object.keys(next).length) setThumbs((prev) => ({ ...prev, ...next }));
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listEntries.length]);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: isMobile ? "stretch" : "flex-start", flexDirection: isMobile ? "column" : "row", gap: isMobile ? 14 : 0 }}>
        <div>
          <h1 style={{ fontFamily: "Fraunces, serif", fontSize: isMobile ? 22 : 28, fontWeight: 600, margin: 0 }}>{location}</h1>
          <p style={{ color: inkSoft, fontSize: 13.5, marginTop: 4 }}>Sales log for this location.</p>
        </div>
        <button
          onClick={onLogSale}
          style={{ background: gold, border: "none", borderRadius: 3, padding: "12px 18px", fontWeight: 600, fontSize: 14, color: ink, cursor: "pointer", width: isMobile ? "100%" : "auto" }}
        >
          + Log sale
        </button>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, margin: "20px 0 22px" }}>
        <StatCard label="Total collected" value={fmtAED(total)} />
        <StatCard label="Cash" value={fmtAED(cash)} tint={teal} />
        <StatCard label="Card" value={fmtAED(card)} tint={coral} />
        <StatCard label="Entries" value={entries.length} />
      </div>

      <div style={{ background: "#fff", border: `1px solid ${cardBorder}`, borderRadius: 4, overflow: "hidden" }}>
        <div style={{ padding: "14px 20px", fontSize: 13.5, fontWeight: 600, borderBottom: `1px solid ${cardBorder}` }}>Sale history</div>
        {listEntries.length === 0 && <div style={{ padding: "30px 20px", color: inkSoft, fontSize: 13.5 }}>No sales logged yet for {location}.</div>}
        {listEntries.map((e) =>
          isMobile ? (
            <div key={e.id} style={{ padding: "14px 16px", borderBottom: `1px solid ${cardBorder}`, opacity: e.voided_at ? 0.6 : 1 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: e.method === "cash" ? teal : coral, flexShrink: 0 }} />
                  <div style={{ fontSize: 14, fontWeight: 500 }}>{e.staff_username}</div>
                </div>
                <div style={{ fontFamily: "Fraunces, serif", fontSize: 16, fontWeight: 600, textDecoration: e.voided_at ? "line-through" : "none" }}>{fmtAED(e.amount)}</div>
              </div>
              <div style={{ fontSize: 11.5, color: inkSoft, marginTop: 4, fontFamily: "monospace" }}>{e.ref_number || "—"}<VoidTag sale={e} /></div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6 }}>
                <div style={{ fontSize: 12, color: inkSoft }}>{fmtDate(e.created_at)} · {fmtTime(e.created_at)} · {e.method === "cash" ? "Cash" : "Card"} · {sourceLabel(e.sales_source)}{e.disclaimer_number ? ` · Disclaimer ${e.disclaimer_number}` : ""}</div>
                {e.method === "card" && e.card_photo_path && thumbs[e.card_photo_path] && (
                  <img src={thumbs[e.card_photo_path]} onClick={() => { setPreviewUrl(thumbs[e.card_photo_path]); setPreviewSale(e); }} style={{ width: 34, height: 22, objectFit: "cover", borderRadius: 3, cursor: "pointer", border: `1px solid ${cardBorder}` }} />
                )}
              </div>
              <VoidNote sale={e} />
              {onManage && <div style={{ marginTop: 10 }}><SaleActions sale={e} onManage={onManage} /></div>}
            </div>
          ) : (
            <div key={e.id} style={{ display: "flex", alignItems: "center", padding: "14px 20px", borderBottom: `1px solid ${cardBorder}`, gap: 14, opacity: e.voided_at ? 0.6 : 1 }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: e.method === "cash" ? teal : coral, flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 500 }}>{e.staff_username} <span style={{ color: inkSoft, fontWeight: 400, fontFamily: "monospace", fontSize: 12 }}>· {e.ref_number || "—"}</span><VoidTag sale={e} /></div>
                <div style={{ fontSize: 12, color: inkSoft }}>
                  {fmtDate(e.created_at)} · {fmtTime(e.created_at)} · {e.method === "cash" ? "Cash" : "Credit card"} · {sourceLabel(e.sales_source)}{e.disclaimer_number ? ` · Disclaimer ${e.disclaimer_number}` : ""}
                  {e.method === "card" && e.card_auth_code && <span style={{ fontFamily: "monospace" }}> · auth {e.card_auth_code}</span>}
                </div>
                <VoidNote sale={e} />
              </div>
              {e.method === "card" && e.card_photo_path && thumbs[e.card_photo_path] && (
                <img src={thumbs[e.card_photo_path]} onClick={() => { setPreviewUrl(thumbs[e.card_photo_path]); setPreviewSale(e); }} style={{ width: 40, height: 26, objectFit: "cover", borderRadius: 3, cursor: "pointer", border: `1px solid ${cardBorder}` }} />
              )}
              <div style={{ fontFamily: "Fraunces, serif", fontSize: 16, fontWeight: 600, width: 110, textAlign: "right", textDecoration: e.voided_at ? "line-through" : "none" }}>{fmtAED(e.amount)}</div>
              {onManage && <div style={{ width: 130, textAlign: "right" }}><SaleActions sale={e} onManage={onManage} /></div>}
            </div>
          )
        )}
      </div>

      {previewUrl && (
        <div onClick={() => setPreviewUrl(null)} style={{ position: "fixed", inset: 0, background: "rgba(20,36,32,0.85)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, zIndex: 50, cursor: "zoom-out" }}>
          <img src={previewUrl} style={{ maxWidth: "90%", maxHeight: "80%", borderRadius: 4 }} />
          <button
            onClick={(e) => { e.stopPropagation(); if (previewSale) downloadSlip(previewSale); }}
            style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, border: "none", cursor: "pointer", background: paper, color: ink, borderRadius: 3, padding: "9px 16px", fontWeight: 600 }}
          >
            <Download size={14} /> Download slip
          </button>
        </div>
      )}
    </div>
  );
}

function LogSaleModal({ location, profile, onClose, onSubmit, isMobile }) {
  const [amount, setAmount] = useState("");
  const [disclaimer, setDisclaimer] = useState("");
  const [dupRef, setDupRef] = useState(null); // set when the disclaimer number is already on another bill
  const [method, setMethod] = useState("cash");
  const [source, setSource] = useState(null);
  const [cardFile, setCardFile] = useState(null);
  const [cardPreview, setCardPreview] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [ocrText, setOcrText] = useState("");
  const [authCode, setAuthCode] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedRef, setSavedRef] = useState(null);
  const fileRef = useRef(null);

  async function handleFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    setCardFile(file);
    setCardPreview(URL.createObjectURL(file));
    setAuthCode("");
    setOcrText("");
    setScanning(true);
    try {
      const Tesseract = (await import("tesseract.js")).default;
      const { data } = await Tesseract.recognize(file, "eng");
      setOcrText(data.text || "");
      setAuthCode(extractAuthCode(data.text));
    } catch (err) {
      console.error("OCR failed", err);
    }
    setScanning(false);
  }

  const canSubmit = amount && Number(amount) > 0 && disclaimer.trim().length > 0 && source && (method === "cash" || (method === "card" && cardFile)) && !saving && !scanning;

  async function handleSave(skipDuplicateCheck) {
    setSaving(true);
    if (skipDuplicateCheck !== true) {
      // Warn (do not block) when this disclaimer number is already on another bill, at any location.
      const { data: used, error: usedErr } = await supabase.rpc("disclaimer_used", { num: disclaimer.trim() });
      if (!usedErr && used) {
        setDupRef(used);
        setSaving(false);
        return;
      }
    }
    let card_photo_path = null;
    if (method === "card" && cardFile) {
      const path = `${location}/${Date.now()}-${profile.username}.jpg`;
      const { error: uploadError } = await supabase.storage.from("card-photos").upload(path, cardFile);
      if (uploadError) {
        alert("Could not upload photo: " + uploadError.message);
        setSaving(false);
        return;
      }
      card_photo_path = path;
    }
    const saved = await onSubmit({
      location,
      staff_username: profile.username,
      amount: Number(amount),
      disclaimer_number: disclaimer.trim(),
      method,
      card_photo_path,
      sales_source: source,
      card_auth_code: method === "card" ? authCode || null : null,
      card_ocr_text: method === "card" ? (ocrText || "").slice(0, 2000) || null : null,
    });
    setSaving(false);
    if (saved) {
      setSavedRef(saved.ref_number);
      setTimeout(onClose, 1800);
    }
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(20,36,32,0.55)", display: "flex", alignItems: isMobile ? "flex-end" : "center", justifyContent: "center", zIndex: 40 }}>
      <div style={{ width: isMobile ? "100%" : 400, maxHeight: isMobile ? "92vh" : "auto", overflowY: "auto", background: paper, borderRadius: isMobile ? "10px 10px 0 0" : 4, padding: "26px 26px 22px", border: `1px solid ${cardBorder}`, boxSizing: "border-box" }}>
        {savedRef ? (
          <div style={{ textAlign: "center", padding: "20px 0" }}>
            <div style={{ width: 44, height: 44, borderRadius: "50%", background: teal, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px" }}>
              <Check size={22} color="#fff" />
            </div>
            <div style={{ fontFamily: "Fraunces, serif", fontSize: 18, fontWeight: 600, marginBottom: 6 }}>Sale saved</div>
            <div style={{ fontSize: 13, color: inkSoft }}>Reference</div>
            <div style={{ fontFamily: "monospace", fontSize: 17, marginTop: 2 }}>{savedRef}</div>
            {authCode && (
              <>
                <div style={{ fontSize: 13, color: inkSoft, marginTop: 12 }}>Authorization code</div>
                <div style={{ fontFamily: "monospace", fontSize: 15, marginTop: 2 }}>{authCode}</div>
              </>
            )}
          </div>
        ) : (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <div style={{ fontFamily: "Fraunces, serif", fontSize: 19, fontWeight: 600 }}>Log a sale</div>
              <X size={20} onClick={onClose} style={{ cursor: "pointer", color: inkSoft }} />
            </div>
            <div style={{ fontSize: 12.5, color: inkSoft, marginBottom: 20 }}>{location} · logged by {profile.username}</div>

            <label style={labelStyle}>Amount (AED)</label>
            <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" style={{ ...inputStyle, marginBottom: 18, fontSize: 16 }} />

            <label style={labelStyle}>Disclaimer number</label>
            <input
              value={disclaimer}
              onChange={(e) => { setDisclaimer(e.target.value); setDupRef(null); }}
              placeholder="Number on the signed disclaimer"
              style={{ ...inputStyle, marginBottom: dupRef ? 8 : 18, fontSize: 16 }}
            />
            {dupRef && (
              <div style={{ background: "#FBF3E4", border: `1px solid ${gold}`, borderRadius: 3, padding: "10px 12px", fontSize: 12.5, color: ink, marginBottom: 18, lineHeight: 1.45 }}>
                This disclaimer number is already on bill <span style={{ fontFamily: "monospace" }}>{dupRef}</span>. Check the number. If it is correct, press Save anyway.
              </div>
            )}

            <label style={{ ...labelStyle, marginBottom: 7 }}>Sales source</label>
            <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
              {SOURCES.map((s) => (
                <button
                  key={s.value}
                  onClick={() => setSource(s.value)}
                  style={{ flex: 1, padding: "11px 4px", borderRadius: 3, border: `1px solid ${source === s.value ? ink : cardBorder}`, background: source === s.value ? ink : "#fff", color: source === s.value ? paper : inkSoft, fontSize: 13.5, cursor: "pointer" }}
                >
                  {s.label}
                </button>
              ))}
            </div>

            <label style={{ ...labelStyle, marginBottom: 7 }}>Payment method</label>
            <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
              <button onClick={() => setMethod("cash")} style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 7, padding: "11px 0", borderRadius: 3, border: `1px solid ${method === "cash" ? teal : cardBorder}`, background: method === "cash" ? "rgba(47,111,99,0.1)" : "#fff", color: method === "cash" ? teal : inkSoft, fontSize: 14, cursor: "pointer" }}>
                <Banknote size={16} /> Cash
              </button>
              <button onClick={() => setMethod("card")} style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 7, padding: "11px 0", borderRadius: 3, border: `1px solid ${method === "card" ? coral : cardBorder}`, background: method === "card" ? "rgba(190,90,62,0.1)" : "#fff", color: method === "card" ? coral : inkSoft, fontSize: 14, cursor: "pointer" }}>
                <CreditCard size={16} /> Credit card
              </button>
            </div>

            {method === "card" && (
              <div style={{ marginBottom: 20 }}>
                <label style={{ ...labelStyle, marginBottom: 7 }}>Photo of the slip</label>
                {!cardPreview ? (
                  <div onClick={() => fileRef.current.click()} style={{ border: `1px dashed ${cardBorder}`, borderRadius: 3, padding: "24px 0", textAlign: "center", cursor: "pointer", background: "#fff" }}>
                    <Camera size={22} color={inkSoft} style={{ marginBottom: 6 }} />
                    <div style={{ fontSize: 13, color: inkSoft }}>Take or upload a photo of the card slip</div>
                  </div>
                ) : (
                  <div style={{ position: "relative" }}>
                    <img src={cardPreview} style={{ width: "100%", height: 130, objectFit: "cover", borderRadius: 3, border: `1px solid ${cardBorder}` }} />
                    <div onClick={() => { setCardFile(null); setCardPreview(null); setAuthCode(""); setOcrText(""); }} style={{ position: "absolute", top: 6, right: 6, background: ink, borderRadius: "50%", width: 24, height: 24, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                      <X size={13} color={paper} />
                    </div>
                  </div>
                )}
                <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={handleFile} style={{ display: "none" }} />

                {scanning && (
                  <div style={{ fontSize: 12.5, color: inkSoft, marginTop: 10, display: "flex", alignItems: "center", gap: 6 }}>
                    Reading the slip...
                  </div>
                )}

                {!scanning && cardPreview && (
                  <div style={{ marginTop: 12 }}>
                    <label style={labelStyle}>Authorization code {authCode ? "(detected — check it)" : "(not detected, enter manually)"}</label>
                    <input
                      value={authCode}
                      onChange={(e) => setAuthCode(e.target.value.toUpperCase())}
                      placeholder="e.g. A1B2C3"
                      style={{ ...inputStyle, marginBottom: 0, fontFamily: "monospace", background: authCode ? "#fff" : "#FBF3E4" }}
                    />
                  </div>
                )}
              </div>
            )}

            <button
              disabled={!canSubmit}
              onClick={() => handleSave(!!dupRef)}
              style={{ width: "100%", padding: "13px 0", borderRadius: 3, border: "none", background: canSubmit ? gold : "#CFC6AE", color: ink, fontWeight: 600, fontSize: 15, cursor: canSubmit ? "pointer" : "not-allowed", display: "flex", alignItems: "center", justifyContent: "center", gap: 7 }}
            >
              <Check size={16} /> {saving ? "Saving..." : dupRef ? "Save anyway" : "Save sale"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function Reports({ sales, allSales, locations, onManage, changeTick, isMobile }) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [refQuery, setRefQuery] = useState("");
  const [refResult, setRefResult] = useState(undefined); // undefined = not searched, null = not found
  const [refImgUrl, setRefImgUrl] = useState(null);
  const [searching, setSearching] = useState(false);
  const [zipBusy, setZipBusy] = useState(false);
  const [rates, setRates] = useState({});

  useEffect(() => {
    supabase.from("commission_rates").select("*").then(({ data }) => {
      const m = {};
      (data || []).forEach((r) => { m[r.username] = Number(r.rate); });
      setRates(m);
    });
  }, []);
  const [zipProgress, setZipProgress] = useState(0);

  const inRange = (s) => {
    const t = new Date(s.created_at).getTime();
    if (from && t < new Date(from + "T00:00:00").getTime()) return false;
    if (to && t > new Date(to + "T23:59:59.999").getTime()) return false;
    return true;
  };
  const filtered = sales.filter(inRange); // live bills only: used for every total
  const filteredAll = (allSales || sales).filter(inRange); // includes voided bills: used for the list and CSV

  const totalCash = filtered.filter((s) => s.method === "cash").reduce((sum, s) => sum + Number(s.amount), 0);
  const totalCard = filtered.filter((s) => s.method === "card").reduce((sum, s) => sum + Number(s.amount), 0);
  const grandTotal = totalCash + totalCard;

  const cardSlips = filtered.filter((s) => s.method === "card" && s.card_photo_path);

  const byPhotographer = {};
  filtered.forEach((s) => {
    (byPhotographer[s.staff_username] = byPhotographer[s.staff_username] || []).push(s);
  });
  const commissionRows = Object.keys(byPhotographer).sort().map((u) => {
    const b = calcBreakdown(byPhotographer[u]);
    const rate = rates[u] || 0;
    return { username: u, count: byPhotographer[u].length, rate, ...b, commission: (b.net * rate) / 100 };
  });
  const commissionTotals = {
    ...calcBreakdown(filtered),
    commission: commissionRows.reduce((sum, r) => sum + r.commission, 0),
  };

  function exportCommissionCSV() {
    const rows = [["Photographer", "Sales", "Gross sales", "Gross excl. VAT", "VAT (5%)", "Card charges (3.25%)", "Net sales", "Commission %", "Commission"]];
    commissionRows.forEach((r) => {
      rows.push([r.username, r.count, r.gross.toFixed(2), r.exVat.toFixed(2), r.vat.toFixed(2), r.cc.toFixed(2), r.net.toFixed(2), r.rate, r.commission.toFixed(2)]);
    });
    rows.push(["TOTAL", filtered.length, commissionTotals.gross.toFixed(2), commissionTotals.exVat.toFixed(2), commissionTotals.vat.toFixed(2), commissionTotals.cc.toFixed(2), commissionTotals.net.toFixed(2), "", commissionTotals.commission.toFixed(2)]);
    const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    saveBlob(blob, `commission-${from || "all"}_to_${to || "all"}.csv`);
  }

  async function downloadAllSlips() {
    if (cardSlips.length === 0) return;
    setZipBusy(true);
    setZipProgress(0);
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();
    let failed = 0;
    for (let i = 0; i < cardSlips.length; i++) {
      const s = cardSlips[i];
      const { data, error } = await supabase.storage.from("card-photos").download(s.card_photo_path);
      if (error || !data) failed++;
      else zip.file(`${s.ref_number || s.id}.jpg`, data);
      setZipProgress(i + 1);
    }
    const blob = await zip.generateAsync({ type: "blob" });
    saveBlob(blob, `card-slips-${from || "all"}_to_${to || "all"}.zip`);
    setZipBusy(false);
    if (failed) alert(failed + " slip(s) could not be downloaded.");
  }

  async function searchRef() {
    if (!refQuery.trim()) return;
    setSearching(true);
    setRefImgUrl(null);
    const q = refQuery.trim();
    let { data: found } = await supabase.from("sales").select("*").ilike("ref_number", q).limit(1);
    if (!found || found.length === 0) {
      const res = await supabase.from("sales").select("*").ilike("disclaimer_number", q).order("created_at", { ascending: false }).limit(1);
      found = res.data;
    }
    const data = found && found.length > 0 ? found[0] : null;
    setRefResult(data || null);
    if (data && data.card_photo_path) {
      const { data: signed } = await supabase.storage.from("card-photos").createSignedUrl(data.card_photo_path, 3600);
      if (signed) setRefImgUrl(signed.signedUrl);
    }
    setSearching(false);
  }

  function exportCSV() {
    const rows = [["Ref", "Date", "Time", "Location", "Staff", "Amount (AED)", "Method", "Source", "Disclaimer no.", "Auth code", "Card photo attached", "Status", "Void reason"]];
    filteredAll.forEach((s) => {
      rows.push([s.ref_number || "", fmtDate(s.created_at), fmtTime(s.created_at), s.location, s.staff_username, Number(s.amount).toFixed(2), s.method, sourceLabel(s.sales_source), s.disclaimer_number || "", s.card_auth_code || "", s.card_photo_path ? "Yes" : "No", s.voided_at ? "VOID" : "Active", s.void_reason || ""]);
    });
    const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sales-ledger-${from || "all"}_to_${to || "all"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <h1 style={{ fontFamily: "Fraunces, serif", fontSize: isMobile ? 22 : 28, fontWeight: 600, margin: 0 }}>Reports</h1>
      <p style={{ color: inkSoft, fontSize: 13.5, marginTop: 4, marginBottom: 22 }}>Export the sales ledger for finance review.</p>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end", marginBottom: 18 }}>
        <div style={{ flex: isMobile ? "1 1 45%" : "0 0 auto" }}>
          <label style={labelStyle}>From</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: isMobile ? "100%" : "auto", padding: "10px 10px", borderRadius: 3, border: `1px solid ${cardBorder}`, fontSize: 13.5, background: "#fff", boxSizing: "border-box" }} />
        </div>
        <div style={{ flex: isMobile ? "1 1 45%" : "0 0 auto" }}>
          <label style={labelStyle}>To</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: isMobile ? "100%" : "auto", padding: "10px 10px", borderRadius: 3, border: `1px solid ${cardBorder}`, fontSize: 13.5, background: "#fff", boxSizing: "border-box" }} />
        </div>
        <button onClick={exportCSV} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 7, background: ink, color: paper, border: "none", borderRadius: 3, padding: "11px 16px", fontSize: 13.5, fontWeight: 600, cursor: "pointer", flex: isMobile ? "1 1 100%" : "0 0 auto" }}>
          <Download size={14} /> Export CSV
        </button>
      </div>
      <div style={{ fontSize: 12, color: inkSoft, marginBottom: 22 }}>Leave both dates blank to export full history. {filtered.length} entries in range.</div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 20 }}>
        <StatCard label="Total cash" value={fmtAED(totalCash)} tint={teal} />
        <StatCard label="Total credit card" value={fmtAED(totalCard)} tint={coral} />
        <StatCard label="Grand total" value={fmtAED(grandTotal)} />
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 20 }}>
        {[...SOURCES, { value: null, label: "Not set" }].map((src) => {
          const rows = filtered.filter((s) => (s.sales_source || null) === src.value);
          if (src.value === null && rows.length === 0) return null;
          const total = rows.reduce((sum, s) => sum + Number(s.amount), 0);
          return <StatCard key={src.label} label={`${src.label} · ${rows.length} sales`} value={fmtAED(total)} />;
        })}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 26 }}>
        {locations.map((loc) => {
          const e = filtered.filter((s) => s.location === loc);
          const total = e.reduce((sum, s) => sum + Number(s.amount), 0);
          return (
            <div key={loc} style={{ flex: "1 1 160px", background: "#fff", border: `1px solid ${cardBorder}`, borderRadius: 4, padding: "16px 18px" }}>
              <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 8 }}>{loc}</div>
              <div style={{ fontFamily: "Fraunces, serif", fontSize: 19 }}>{fmtAED(total)}</div>
              <div style={{ fontSize: 12, color: inkSoft, marginTop: 4 }}>{e.length} entries</div>
            </div>
          );
        })}
      </div>

      <div style={{ background: "#fff", border: `1px solid ${cardBorder}`, borderRadius: 4, marginBottom: 26, overflow: "hidden" }}>
        <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", justifyContent: "space-between", alignItems: isMobile ? "stretch" : "center", gap: 10, padding: "14px 16px", borderBottom: `1px solid ${cardBorder}` }}>
          <div>
            <div style={{ fontSize: 13.5, fontWeight: 600 }}>Photographer commission</div>
            <div style={{ fontSize: 12, color: inkSoft, marginTop: 2 }}>For the dates selected above.</div>
          </div>
          <button onClick={exportCommissionCSV} disabled={commissionRows.length === 0} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 7, background: commissionRows.length === 0 ? "#CFC6AE" : ink, color: commissionRows.length === 0 ? ink : paper, border: "none", borderRadius: 3, padding: "10px 16px", fontSize: 13, fontWeight: 600, cursor: commissionRows.length === 0 ? "not-allowed" : "pointer" }}>
            <Download size={14} /> Export commission CSV
          </button>
        </div>

        {commissionRows.length === 0 && <div style={{ padding: "26px 16px", fontSize: 13, color: inkSoft }}>No sales in this range.</div>}

        {commissionRows.length > 0 && !isMobile && (
          <div style={{ fontSize: 13 }}>
            <div style={{ display: "flex", padding: "10px 16px", fontSize: 11.5, color: inkSoft, borderBottom: `1px solid ${cardBorder}` }}>
              <div style={{ flex: 1.3 }}>Photographer</div>
              <div style={{ flex: 0.6, textAlign: "right" }}>Rate</div>
              <div style={{ flex: 1, textAlign: "right" }}>Gross sales</div>
              <div style={{ flex: 1, textAlign: "right" }}>Excl. VAT</div>
              <div style={{ flex: 1, textAlign: "right" }}>Card charges</div>
              <div style={{ flex: 1, textAlign: "right" }}>Net sales</div>
              <div style={{ flex: 1.1, textAlign: "right" }}>Commission</div>
            </div>
            {commissionRows.map((r) => (
              <div key={r.username} style={{ display: "flex", alignItems: "center", padding: "12px 16px", borderBottom: `1px solid ${cardBorder}` }}>
                <div style={{ flex: 1.3, fontWeight: 500 }}>{r.username}<div style={{ fontSize: 11, color: inkSoft, fontWeight: 400 }}>{r.count} sales</div></div>
                <div style={{ flex: 0.6, textAlign: "right", color: r.rate ? ink : coral }}>{r.rate ? r.rate + "%" : "not set"}</div>
                <div style={{ flex: 1, textAlign: "right" }}>{fmtAED(r.gross)}</div>
                <div style={{ flex: 1, textAlign: "right" }}>{fmtAED(r.exVat)}</div>
                <div style={{ flex: 1, textAlign: "right", color: coral }}>{fmtAED(r.cc)}</div>
                <div style={{ flex: 1, textAlign: "right" }}>{fmtAED(r.net)}</div>
                <div style={{ flex: 1.1, textAlign: "right", fontFamily: "Fraunces, serif", fontWeight: 600, fontSize: 15 }}>{fmtAED(r.commission)}</div>
              </div>
            ))}
            <div style={{ display: "flex", alignItems: "center", padding: "12px 16px", background: "#F6F2EA", fontWeight: 600 }}>
              <div style={{ flex: 1.3 }}>Total</div>
              <div style={{ flex: 0.6 }} />
              <div style={{ flex: 1, textAlign: "right" }}>{fmtAED(commissionTotals.gross)}</div>
              <div style={{ flex: 1, textAlign: "right" }}>{fmtAED(commissionTotals.exVat)}</div>
              <div style={{ flex: 1, textAlign: "right" }}>{fmtAED(commissionTotals.cc)}</div>
              <div style={{ flex: 1, textAlign: "right" }}>{fmtAED(commissionTotals.net)}</div>
              <div style={{ flex: 1.1, textAlign: "right", fontFamily: "Fraunces, serif", fontSize: 15 }}>{fmtAED(commissionTotals.commission)}</div>
            </div>
          </div>
        )}

        {commissionRows.length > 0 && isMobile && (
          <div>
            {commissionRows.map((r) => (
              <div key={r.username} style={{ padding: "14px 16px", borderBottom: `1px solid ${cardBorder}`, fontSize: 13 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
                  <div style={{ fontWeight: 600, fontSize: 14.5 }}>{r.username} <span style={{ fontWeight: 400, fontSize: 12, color: r.rate ? inkSoft : coral }}>· {r.rate ? r.rate + "%" : "rate not set"}</span></div>
                  <div style={{ fontFamily: "Fraunces, serif", fontWeight: 600, fontSize: 16 }}>{fmtAED(r.commission)}</div>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", color: inkSoft, marginBottom: 3 }}><span>Gross sales</span><span>{fmtAED(r.gross)}</span></div>
                <div style={{ display: "flex", justifyContent: "space-between", color: inkSoft, marginBottom: 3 }}><span>Excl. VAT</span><span>{fmtAED(r.exVat)}</span></div>
                <div style={{ display: "flex", justifyContent: "space-between", color: coral, marginBottom: 3 }}><span>Card charges</span><span>{fmtAED(r.cc)}</span></div>
                <div style={{ display: "flex", justifyContent: "space-between", color: ink, fontWeight: 500 }}><span>Net sales</span><span>{fmtAED(r.net)}</span></div>
              </div>
            ))}
            <div style={{ padding: "14px 16px", background: "#F6F2EA", fontSize: 13 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 600 }}><span>Total commission</span><span style={{ fontFamily: "Fraunces, serif", fontSize: 16 }}>{fmtAED(commissionTotals.commission)}</span></div>
              <div style={{ display: "flex", justifyContent: "space-between", color: inkSoft, marginTop: 4 }}><span>Gross / Net</span><span>{fmtAED(commissionTotals.gross)} / {fmtAED(commissionTotals.net)}</span></div>
            </div>
          </div>
        )}

        <div style={{ padding: "12px 16px", fontSize: 11.5, color: inkSoft, lineHeight: 1.5, borderTop: commissionRows.length ? `1px solid ${cardBorder}` : "none" }}>
          Excl. VAT = gross ÷ 1.05. Card charges = 3.25% of card sales. Net sales = gross − (VAT + card charges). Commission = net sales × the photographer rate.
        </div>
      </div>

      <div style={{ background: "#fff", border: `1px solid ${cardBorder}`, borderRadius: 4, marginBottom: 26, overflow: "hidden" }}>
        <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", justifyContent: "space-between", alignItems: isMobile ? "stretch" : "center", gap: 10, padding: "14px 16px", borderBottom: `1px solid ${cardBorder}` }}>
          <div>
            <div style={{ fontSize: 13.5, fontWeight: 600 }}>Sales in range</div>
            <div style={{ fontSize: 12, color: inkSoft, marginTop: 2 }}>{filtered.length} sales · {cardSlips.length} card slips on file{filteredAll.length > filtered.length ? ` · ${filteredAll.length - filtered.length} voided` : ""}</div>
          </div>
          <button
            onClick={downloadAllSlips}
            disabled={zipBusy || cardSlips.length === 0}
            style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 7, background: zipBusy || cardSlips.length === 0 ? "#CFC6AE" : ink, color: zipBusy || cardSlips.length === 0 ? ink : paper, border: "none", borderRadius: 3, padding: "10px 16px", fontSize: 13, fontWeight: 600, cursor: zipBusy || cardSlips.length === 0 ? "not-allowed" : "pointer" }}
          >
            <Download size={14} /> {zipBusy ? `Preparing ${zipProgress}/${cardSlips.length}...` : "Download all slips (ZIP)"}
          </button>
        </div>
        <div style={{ maxHeight: 480, overflowY: "auto" }}>
          {filteredAll.length === 0 && <div style={{ padding: "26px 16px", fontSize: 13, color: inkSoft }}>No sales in this range.</div>}
          {filteredAll.map((s) => (
            <div key={s.id} style={{ display: "flex", flexDirection: isMobile ? "column" : "row", alignItems: isMobile ? "stretch" : "center", gap: isMobile ? 6 : 14, padding: "12px 16px", borderBottom: `1px solid ${cardBorder}`, fontSize: 13, opacity: s.voided_at ? 0.6 : 1 }}>
              <div style={{ fontFamily: "monospace", fontSize: 12, width: isMobile ? "auto" : 92 }}>{s.ref_number || "—"}{s.voided_at && <div><VoidTag sale={s} /></div>}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 500 }}>{s.staff_username} · {s.location}</div>
                <div style={{ fontSize: 11.5, color: inkSoft }}>
                  {fmtDate(s.created_at)} · {fmtTime(s.created_at)} · {s.method === "cash" ? "Cash" : "Credit card"} · {sourceLabel(s.sales_source)}{s.disclaimer_number ? ` · Disclaimer ${s.disclaimer_number}` : ""}
                  {s.method === "card" && s.card_auth_code && <span style={{ fontFamily: "monospace" }}> · auth {s.card_auth_code}</span>}
                </div>
                <VoidNote sale={s} />
              </div>
              <div style={{ fontFamily: "Fraunces, serif", fontWeight: 600, width: isMobile ? "auto" : 100, textAlign: isMobile ? "left" : "right", textDecoration: s.voided_at ? "line-through" : "none" }}>{fmtAED(s.amount)}</div>
              <div style={{ width: isMobile ? "auto" : 130, textAlign: isMobile ? "left" : "right" }}>
                {s.method === "card" && s.card_photo_path ? (
                  <button onClick={() => downloadSlip(s)} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "transparent", color: ink, border: `1px solid ${ink}`, borderRadius: 3, padding: "6px 10px", fontSize: 12, cursor: "pointer" }}>
                    <Download size={12} /> Download slip
                  </button>
                ) : s.method === "card" ? (
                  <span style={{ fontSize: 12, color: coral }}>No slip on file</span>
                ) : (
                  <span style={{ fontSize: 12, color: inkSoft }}>Cash</span>
                )}
              </div>
              {onManage && <div style={{ width: isMobile ? "auto" : 120, textAlign: isMobile ? "left" : "right" }}><SaleActions sale={s} onManage={onManage} /></div>}
            </div>
          ))}
        </div>
      </div>

      <div style={{ background: "#fff", border: `1px solid ${cardBorder}`, borderRadius: 4, padding: isMobile ? "16px" : "18px 20px" }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 4 }}>Look up a sale by reference or disclaimer number</div>
        <p style={{ fontSize: 12, color: inkSoft, marginBottom: 14 }}>Find a specific sale and its card photo, e.g. for matching against a bank statement.</p>
        <div style={{ display: "flex", gap: 8, marginBottom: refResult !== undefined ? 16 : 0 }}>
          <input
            value={refQuery}
            onChange={(e) => setRefQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && searchRef()}
            placeholder="SL-000012 or disclaimer number"
            style={{ flex: 1, padding: "10px 12px", borderRadius: 3, border: `1px solid ${cardBorder}`, fontSize: 13.5, background: "#fff", fontFamily: "monospace" }}
          />
          <button onClick={searchRef} style={{ display: "flex", alignItems: "center", gap: 6, background: ink, color: paper, border: "none", borderRadius: 3, padding: "10px 16px", fontSize: 13.5, fontWeight: 600, cursor: "pointer" }}>
            <Search size={14} /> {searching ? "..." : "Find"}
          </button>
        </div>

        {refResult === null && <div style={{ fontSize: 13, color: coral }}>No sale found with that reference.</div>}

        {refResult && (
          <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", gap: 16, alignItems: isMobile ? "stretch" : "flex-start", border: `1px solid ${cardBorder}`, borderRadius: 4, padding: 14 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: "monospace", fontSize: 14, marginBottom: 6 }}>{refResult.ref_number}<VoidTag sale={refResult} /></div>
              <VoidNote sale={refResult} />
              <div style={{ fontSize: 13.5, fontWeight: 500 }}>{refResult.staff_username} · {refResult.location}</div>
              <div style={{ fontSize: 12, color: inkSoft, marginTop: 2 }}>{fmtDate(refResult.created_at)} · {fmtTime(refResult.created_at)}</div>
              <div style={{ fontFamily: "Fraunces, serif", fontSize: 18, marginTop: 8 }}>{fmtAED(refResult.amount)}</div>
              <div style={{ fontSize: 12, color: refResult.method === "cash" ? teal : coral, marginTop: 2, textTransform: "capitalize" }}>{refResult.method}</div>
              {refResult.disclaimer_number && (
                <div style={{ fontSize: 12.5, marginTop: 6, fontFamily: "monospace" }}>Disclaimer: {refResult.disclaimer_number}</div>
              )}
              {refResult.method === "card" && refResult.card_auth_code && (
                <div style={{ fontSize: 12.5, marginTop: 6, fontFamily: "monospace" }}>Auth: {refResult.card_auth_code}</div>
              )}
            </div>
            {refResult.method === "card" && (
              refImgUrl ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 8, width: isMobile ? "100%" : 180 }}>
                  <img src={refImgUrl} style={{ width: "100%", height: isMobile ? "auto" : 120, objectFit: "cover", borderRadius: 3, border: `1px solid ${cardBorder}` }} />
                  <button
                    onClick={() => downloadSlip(refResult)}
                    style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, fontSize: 12.5, border: "none", cursor: "pointer", background: ink, color: paper, borderRadius: 3, padding: "9px 0" }}
                  >
                    <Download size={13} /> Download slip
                  </button>
                </div>
              ) : (
                <div style={{ fontSize: 12, color: inkSoft }}>No card photo on file.</div>
              )
            )}
          </div>
        )}
      </div>
      {onManage && <ChangeLog tick={changeTick} />}
    </div>
  );
}

function SaleActions({ sale, onManage }) {
  if (!onManage) return null;
  const btn = { background: "transparent", border: `1px solid ${cardBorder}`, borderRadius: 3, padding: "5px 10px", fontSize: 12, cursor: "pointer", color: ink };
  if (sale.voided_at) {
    return <button onClick={() => onManage(sale, "restore")} style={btn}>Restore</button>;
  }
  return (
    <span style={{ display: "inline-flex", gap: 6 }}>
      <button onClick={() => onManage(sale, "edit")} style={btn}>Edit</button>
      <button onClick={() => onManage(sale, "void")} style={{ ...btn, color: coral, borderColor: coral }}>Void</button>
    </span>
  );
}

function VoidTag({ sale }) {
  if (!sale || !sale.voided_at) return null;
  return (
    <span style={{ display: "inline-block", fontSize: 10.5, fontWeight: 700, letterSpacing: 0.3, color: coral, border: `1px solid ${coral}`, borderRadius: 3, padding: "1px 5px", marginLeft: 6 }}>
      VOID
    </span>
  );
}

function VoidNote({ sale }) {
  if (!sale || !sale.voided_at) return null;
  return (
    <div style={{ fontSize: 11.5, color: coral, marginTop: 3 }}>
      Voided{sale.voided_by ? " by " + sale.voided_by : ""}{sale.void_reason ? ": " + sale.void_reason : ""}
    </div>
  );
}

const AUDIT_FIELDS = { disclaimer_number: "Disclaimer no.", amount: "Amount", method: "Payment", sales_source: "Source", staff_username: "Photographer", location: "Location", card_auth_code: "Auth code" };

function describeChange(row) {
  if (row.action === "void") return "Bill voided";
  if (row.action === "restore") return "Bill restored";
  const o = row.old_data || {};
  const n = row.new_data || {};
  const norm = (k, v) => (v === null || v === undefined || v === "" ? "" : k === "amount" ? Number(v).toFixed(2) : String(v));
  const show = (k, v) => {
    const s = norm(k, v);
    if (s === "") return "none";
    return k === "sales_source" ? sourceLabel(s) : s;
  };
  const parts = [];
  Object.keys(AUDIT_FIELDS).forEach((k) => {
    if (norm(k, o[k]) !== norm(k, n[k])) parts.push(`${AUDIT_FIELDS[k]}: ${show(k, o[k])} → ${show(k, n[k])}`);
  });
  return parts.length ? parts.join("; ") : "Edited";
}

function ChangeLog({ tick }) {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    supabase
      .from("sales_audit")
      .select("*")
      .order("changed_at", { ascending: false })
      .limit(50)
      .then(({ data }) => setRows(data || []));
  }, [tick]);

  return (
    <div style={{ background: "#fff", border: `1px solid ${cardBorder}`, borderRadius: 4, marginTop: 26, overflow: "hidden" }}>
      <div style={{ padding: "14px 16px", borderBottom: `1px solid ${cardBorder}` }}>
        <div style={{ fontSize: 13.5, fontWeight: 600 }}>Changes and voids</div>
        <div style={{ fontSize: 12, color: inkSoft, marginTop: 2 }}>The last 50 edits, voids and restores. Only managers can see this.</div>
      </div>
      <div style={{ maxHeight: 360, overflowY: "auto" }}>
        {rows !== null && rows.length === 0 && <div style={{ padding: "22px 16px", fontSize: 13, color: inkSoft }}>No changes yet.</div>}
        {(rows || []).map((r) => (
          <div key={r.id} style={{ padding: "12px 16px", borderBottom: `1px solid ${cardBorder}`, fontSize: 13 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <div>
                <span style={{ fontFamily: "monospace", fontSize: 12 }}>{r.ref_number || "—"}</span>
                <span style={{ marginLeft: 8, fontWeight: 600, color: r.action === "void" ? coral : r.action === "restore" ? teal : ink, textTransform: "capitalize" }}>{r.action}</span>
              </div>
              <div style={{ fontSize: 11.5, color: inkSoft }}>{fmtDate(r.changed_at)} · {fmtTime(r.changed_at)} · {r.changed_by || "system"}</div>
            </div>
            <div style={{ fontSize: 12.5, marginTop: 4 }}>{describeChange(r)}</div>
            {r.reason && <div style={{ fontSize: 12, color: inkSoft, marginTop: 2 }}>Reason: {r.reason}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

function ManageSaleModal({ sale, mode, profile, locations, onClose, onDone, isMobile }) {
  const [amount, setAmount] = useState(String(sale.amount));
  const [method, setMethod] = useState(sale.method);
  const [source, setSource] = useState(sale.sales_source || null);
  const [staff, setStaff] = useState(sale.staff_username);
  const [location, setLocation] = useState(sale.location);
  const [authCode, setAuthCode] = useState(sale.card_auth_code || "");
  const [disclaimer, setDisclaimer] = useState(sale.disclaimer_number || "");
  const [reason, setReason] = useState("");
  const [usernames, setUsernames] = useState([sale.staff_username]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (mode !== "edit") return;
    supabase.from("profiles").select("username, role, location").order("username").then(({ data }) => {
      // An admin can only pick photographers who work at their own locations.
      const pool = profile.role === "admin" ? (data || []).filter((p) => p.role === "staff" && locations.includes(p.location)) : data || [];
      const names = pool.map((p) => p.username);
      if (!names.includes(sale.staff_username)) names.push(sale.staff_username);
      setUsernames(names);
    });
  }, [mode, sale.staff_username, profile.role, locations]);

  const isVoid = mode === "void";
  const title = mode === "edit" ? "Edit bill" : isVoid ? "Void bill" : "Restore bill";
  const canSave = reason.trim().length >= 3 && !saving && (mode !== "edit" || (Number(amount) > 0 && (!sale.disclaimer_number || disclaimer.trim().length > 0)));

  async function handleSave() {
    setSaving(true);
    setError("");
    let fields;
    if (mode === "edit") {
      fields = {
        amount: Number(amount),
        method,
        sales_source: source,
        staff_username: staff,
        location,
        card_auth_code: method === "card" ? authCode.trim() || null : null,
        disclaimer_number: disclaimer.trim() || null,
      };
    } else if (isVoid) {
      fields = { voided_at: new Date().toISOString(), voided_by: profile.username, void_reason: reason.trim() };
    } else {
      fields = { voided_at: null, voided_by: null, void_reason: null };
    }
    const { data, error: err } = await supabase
      .from("sales")
      .update({ ...fields, last_change_reason: reason.trim() })
      .eq("id", sale.id)
      .select();
    setSaving(false);
    if (err) {
      setError(err.message);
      return;
    }
    if (!data || data.length === 0) {
      setError("The change was not saved. Check you are signed in as manager.");
      return;
    }
    onDone();
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(20,36,32,0.55)", display: "flex", alignItems: isMobile ? "flex-end" : "center", justifyContent: "center", zIndex: 45 }}>
      <div style={{ width: isMobile ? "100%" : 420, maxHeight: isMobile ? "92vh" : "90vh", overflowY: "auto", background: paper, borderRadius: isMobile ? "10px 10px 0 0" : 4, padding: "26px 26px 22px", border: `1px solid ${cardBorder}`, boxSizing: "border-box" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <div style={{ fontFamily: "Fraunces, serif", fontSize: 19, fontWeight: 600 }}>{title}</div>
          <X size={20} onClick={onClose} style={{ cursor: "pointer", color: inkSoft }} />
        </div>
        <div style={{ fontSize: 12.5, color: inkSoft, marginBottom: 18, fontFamily: "monospace" }}>{sale.ref_number} · {sale.staff_username} · {fmtAED(sale.amount)}</div>

        {mode === "edit" && (
          <>
            <label style={labelStyle}>Amount (AED)</label>
            <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} style={{ ...inputStyle, marginBottom: 16, fontSize: 16 }} />

            <label style={{ ...labelStyle, marginBottom: 7 }}>Sales source</label>
            <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
              {SOURCES.map((s) => (
                <button key={s.value} onClick={() => setSource(s.value)} style={{ flex: 1, padding: "10px 4px", borderRadius: 3, border: `1px solid ${source === s.value ? ink : cardBorder}`, background: source === s.value ? ink : "#fff", color: source === s.value ? paper : inkSoft, fontSize: 13, cursor: "pointer" }}>
                  {s.label}
                </button>
              ))}
            </div>

            <label style={{ ...labelStyle, marginBottom: 7 }}>Payment method</label>
            <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
              <button onClick={() => setMethod("cash")} style={{ flex: 1, padding: "10px 0", borderRadius: 3, border: `1px solid ${method === "cash" ? teal : cardBorder}`, background: method === "cash" ? "rgba(47,111,99,0.1)" : "#fff", color: method === "cash" ? teal : inkSoft, fontSize: 13.5, cursor: "pointer" }}>Cash</button>
              <button onClick={() => setMethod("card")} style={{ flex: 1, padding: "10px 0", borderRadius: 3, border: `1px solid ${method === "card" ? coral : cardBorder}`, background: method === "card" ? "rgba(190,90,62,0.1)" : "#fff", color: method === "card" ? coral : inkSoft, fontSize: 13.5, cursor: "pointer" }}>Credit card</button>
            </div>

            {method === "card" && (
              <>
                <label style={labelStyle}>Authorization code</label>
                <input value={authCode} onChange={(e) => setAuthCode(e.target.value.toUpperCase())} style={{ ...inputStyle, marginBottom: 16, fontFamily: "monospace" }} />
              </>
            )}

            <label style={labelStyle}>Disclaimer number</label>
            <input value={disclaimer} onChange={(e) => setDisclaimer(e.target.value)} style={{ ...inputStyle, marginBottom: 16 }} />

            <label style={labelStyle}>Photographer</label>
            <select value={staff} onChange={(e) => setStaff(e.target.value)} style={{ ...inputStyle, marginBottom: 16 }}>
              {usernames.map((u) => (<option key={u} value={u}>{u}</option>))}
            </select>

            <label style={labelStyle}>Location</label>
            <select value={location} onChange={(e) => setLocation(e.target.value)} style={{ ...inputStyle, marginBottom: 16 }}>
              {Array.from(new Set([sale.location, ...locations])).map((l) => (<option key={l} value={l}>{l}</option>))}
            </select>
          </>
        )}

        {isVoid && (
          <p style={{ fontSize: 13, color: inkSoft, lineHeight: 1.5, marginBottom: 16 }}>
            This bill stays in the list marked VOID. It no longer counts in totals, card charges or commission. You can restore it later.
          </p>
        )}
        {mode === "restore" && (
          <p style={{ fontSize: 13, color: inkSoft, lineHeight: 1.5, marginBottom: 16 }}>
            This bill will count in totals, card charges and commission again.
          </p>
        )}

        <label style={labelStyle}>Reason (required)</label>
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Wrong amount entered" style={{ ...inputStyle, marginBottom: 16 }} />

        {error && <div style={{ color: coral, fontSize: 12.5, marginBottom: 12 }}>{error}</div>}

        <button
          disabled={!canSave}
          onClick={handleSave}
          style={{ width: "100%", padding: "13px 0", borderRadius: 3, border: "none", background: !canSave ? "#CFC6AE" : isVoid ? coral : gold, color: !canSave ? ink : isVoid ? "#fff" : ink, fontWeight: 600, fontSize: 15, cursor: canSave ? "pointer" : "not-allowed" }}
        >
          {saving ? "Saving..." : mode === "edit" ? "Save changes" : isVoid ? "Void this bill" : "Restore this bill"}
        </button>
      </div>
    </div>
  );
}

function StaffView({ sales, profile, locations, isMobile }) {
  const isAdmin = profile.role === "admin";
  const [profiles, setProfiles] = useState([]);
  const [busyId, setBusyId] = useState(null);
  const [rates, setRates] = useState({});
  const [adminMap, setAdminMap] = useState({}); // username -> locations an admin oversees (manager view only)

  const loadRates = useCallback(() => {
    supabase.from("commission_rates").select("*").then(({ data }) => {
      const m = {};
      (data || []).forEach((r) => { m[r.username] = Number(r.rate); });
      setRates(m);
    });
  }, []);

  useEffect(() => { loadRates(); }, [loadRates]);

  const loadAdminMap = useCallback(() => {
    if (isAdmin) return;
    supabase.from("admin_locations").select("*").then(({ data }) => {
      const m = {};
      (data || []).forEach((r) => { (m[r.username] = m[r.username] || []).push(r.location); });
      setAdminMap(m);
    });
  }, [isAdmin]);

  useEffect(() => { loadAdminMap(); }, [loadAdminMap]);

  async function saveRate(username, value) {
    const { error } = await supabase.from("commission_rates").upsert({ username, rate: value });
    if (error) alert("Could not save commission: " + error.message);
    await loadRates();
  }

  function rateInput(username, small) {
    const current = rates[username] || 0;
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
        <input
          type="number"
          min="0"
          max="100"
          step="0.5"
          defaultValue={current}
          key={username + "-" + current}
          onBlur={(e) => {
            const v = Number(e.target.value);
            if (!isNaN(v) && v >= 0 && v <= 100 && v !== current) saveRate(username, v);
          }}
          style={{ width: small ? 56 : 64, fontSize: small ? 12.5 : 13, padding: small ? "5px 6px" : "8px 6px", borderRadius: 3, border: `1px solid ${cardBorder}`, background: "#fff" }}
        />
        <span style={{ fontSize: 12.5, color: inkSoft }}>%</span>
      </span>
    );
  }

  const loadProfiles = useCallback(() => {
    supabase.from("profiles").select("*").order("username").then(({ data }) => setProfiles(data || []));
  }, []);

  useEffect(() => { loadProfiles(); }, [loadProfiles]);

  // An admin only sees staff at their own locations, plus new accounts that have no location yet.
  const visibleProfiles = isAdmin
    ? profiles.filter((p) => p.role === "staff" && (!p.location || locations.includes(p.location)))
    : profiles;

  const totalsByUsername = useMemo(() => {
    const map = {};
    sales.forEach((s) => {
      if (!map[s.staff_username]) map[s.staff_username] = { total: 0, count: 0, cash: 0, card: 0 };
      map[s.staff_username].total += Number(s.amount);
      map[s.staff_username].count += 1;
      map[s.staff_username][s.method] += Number(s.amount);
    });
    return map;
  }, [sales]);

  async function updateProfile(id, fields) {
    setBusyId(id);
    const { data, error } = await supabase.from("profiles").update(fields).eq("id", id).select();
    if (error || !data || data.length === 0) alert("That change was not saved." + (error ? " " + error.message : ""));
    await loadProfiles();
    setBusyId(null);
  }

  async function changeRole(p, newRole) {
    setBusyId(p.id);
    const fields = newRole === "staff" ? { role: newRole } : { role: newRole, location: null };
    const { data, error } = await supabase.from("profiles").update(fields).eq("id", p.id).select();
    if (error || !data || data.length === 0) {
      alert("That change was not saved." + (error ? " " + error.message : ""));
    } else if (newRole !== "admin") {
      await supabase.from("admin_locations").delete().eq("username", p.username);
    }
    await loadProfiles();
    await loadAdminMap();
    setBusyId(null);
  }

  async function toggleAdminLocation(username, location, checked) {
    const { error } = checked
      ? await supabase.from("admin_locations").insert({ username, location })
      : await supabase.from("admin_locations").delete().eq("username", username).eq("location", location);
    if (error) alert("Could not save: " + error.message);
    await loadAdminMap();
  }

  function roleCell(p, wide) {
    if (isAdmin) return <span style={{ fontSize: 13, color: inkSoft }}>Staff</span>;
    return (
      <select
        value={p.role}
        disabled={p.id === profile.id}
        onChange={(e) => changeRole(p, e.target.value)}
        style={{ width: wide ? "100%" : "auto", fontSize: wide ? 13 : 12.5, padding: wide ? "8px 6px" : "5px 6px", borderRadius: 3, border: `1px solid ${cardBorder}`, background: "#fff" }}
      >
        <option value="staff">Staff</option>
        <option value="admin">Admin</option>
        <option value="manager">Manager</option>
      </select>
    );
  }

  function locationCell(p, wide) {
    if (p.role === "admin") {
      const set = adminMap[p.username] || [];
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {LOCATIONS.map((l) => (
            <label key={l} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, cursor: "pointer" }}>
              <input type="checkbox" checked={set.includes(l)} onChange={(e) => toggleAdminLocation(p.username, l, e.target.checked)} />
              {l}
            </label>
          ))}
        </div>
      );
    }
    if (p.role === "manager") return <span style={{ fontSize: 12.5, color: inkSoft }}>All locations</span>;
    const options = isAdmin ? locations : LOCATIONS;
    return (
      <select
        value={p.location || ""}
        onChange={(e) => updateProfile(p.id, { location: e.target.value || null })}
        style={{ width: wide ? "100%" : "auto", fontSize: wide ? 13 : 12.5, padding: wide ? "8px 6px" : "5px 6px", borderRadius: 3, border: `1px solid ${cardBorder}`, background: "#fff" }}
      >
        <option value="" disabled={isAdmin}>{isAdmin ? "Assign..." : "—"}</option>
        {options.map((l) => <option key={l} value={l}>{l}</option>)}
      </select>
    );
  }

  return (
    <div>
      <h1 style={{ fontFamily: "Fraunces, serif", fontSize: isMobile ? 22 : 28, fontWeight: 600, margin: 0 }}>Staff</h1>
      <p style={{ color: inkSoft, fontSize: 13.5, marginTop: 4, marginBottom: 24 }}>
        {isAdmin
          ? "Staff at your locations. Move people between your locations, set each photographer commission %, and see totals collected for accountability."
          : "Everyone who has an account. Set roles, assign locations (tick the locations an admin oversees), set each photographer commission %, and see totals collected for accountability."}
      </p>

      {isMobile ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {visibleProfiles.map((p) => {
            const t = totalsByUsername[p.username] || { total: 0, cash: 0, card: 0, count: 0 };
            return (
              <div key={p.id} style={{ background: "#fff", border: `1px solid ${cardBorder}`, borderRadius: 4, padding: 14, opacity: busyId === p.id ? 0.5 : 1 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <div style={{ fontSize: 14.5, fontWeight: 600 }}>{p.username}</div>
                  <div style={{ fontFamily: "Fraunces, serif", fontSize: 16, fontWeight: 600 }}>{fmtAED(t.total)}</div>
                </div>
                <div style={{ display: "flex", gap: 8, marginBottom: 10, alignItems: "flex-start" }}>
                  <div style={{ flex: 1 }}>{roleCell(p, true)}</div>
                  <div style={{ flex: 1 }}>{locationCell(p, true)}</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, fontSize: 12.5, color: inkSoft }}>
                  <span>Commission rate</span>
                  {rateInput(p.username, false)}
                </div>
                <div style={{ display: "flex", gap: 14, fontSize: 12.5 }}>
                  <span style={{ color: teal }}>Cash {fmtAED(t.cash)}</span>
                  <span style={{ color: coral }}>Card {fmtAED(t.card)}</span>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div style={{ background: "#fff", border: `1px solid ${cardBorder}`, borderRadius: 4, overflow: "hidden" }}>
          <div style={{ display: "flex", padding: "12px 20px", fontSize: 11.5, color: inkSoft, borderBottom: `1px solid ${cardBorder}` }}>
            <div style={{ flex: 1.4 }}>Username</div>
            <div style={{ flex: 1 }}>Role</div>
            <div style={{ flex: 1.2 }}>Location</div>
            <div style={{ flex: 1 }}>Commission</div>
            <div style={{ flex: 1, textAlign: "right" }}>Cash</div>
            <div style={{ flex: 1, textAlign: "right" }}>Card</div>
            <div style={{ flex: 1, textAlign: "right" }}>Total</div>
          </div>
          {visibleProfiles.map((p) => {
            const t = totalsByUsername[p.username] || { total: 0, cash: 0, card: 0, count: 0 };
            return (
              <div key={p.id} style={{ display: "flex", padding: "12px 20px", fontSize: 13.5, borderBottom: `1px solid ${cardBorder}`, alignItems: "center", opacity: busyId === p.id ? 0.5 : 1 }}>
                <div style={{ flex: 1.4, fontWeight: 500 }}>{p.username}</div>
                <div style={{ flex: 1 }}>{roleCell(p, false)}</div>
                <div style={{ flex: 1.2 }}>{locationCell(p, false)}</div>
                <div style={{ flex: 1 }}>{rateInput(p.username, true)}</div>
                <div style={{ flex: 1, textAlign: "right", color: teal }}>{fmtAED(t.cash)}</div>
                <div style={{ flex: 1, textAlign: "right", color: coral }}>{fmtAED(t.card)}</div>
                <div style={{ flex: 1, textAlign: "right", fontWeight: 600 }}>{fmtAED(t.total)}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
