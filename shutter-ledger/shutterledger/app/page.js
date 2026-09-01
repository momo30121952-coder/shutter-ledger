"use client";

import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { Camera, ChevronRight, Download, LogOut, Users, LayoutGrid, FileText, MapPin, X, CreditCard, Banknote, Check } from "lucide-react";
import { supabase, usernameToEmail } from "../lib/supabaseClient";

const LOCATIONS = ["Radisson", "Harbour", "Five Hotels"];

const ink = "#142420";
const paper = "#EFEAE1";
const gold = "#C89B3C";
const coral = "#BE5A3E";
const teal = "#2F6F63";
const inkSoft = "#4B5B55";
const cardBorder = "#DCD5C6";

function fmtAED(n) {
  return "AED " + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtDate(iso) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}
function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

export default function Home() {
  const [session, setSession] = useState(undefined); // undefined = loading, null = signed out
  const [profile, setProfile] = useState(null);
  const [sales, setSales] = useState([]);
  const [view, setView] = useState("dashboard");
  const [activeLocation, setActiveLocation] = useState(LOCATIONS[0]);
  const [showLogModal, setShowLogModal] = useState(false);

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

  const loadSales = useCallback(() => {
    supabase
      .from("sales")
      .select("*")
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (!error) setSales(data || []);
      });
  }, []);

  useEffect(() => {
    if (profile) loadSales();
  }, [profile, loadSales]);

  async function addSale(entry) {
    const { error } = await supabase.from("sales").insert(entry);
    if (error) {
      alert("Could not save sale: " + error.message);
      return;
    }
    loadSales();
  }

  if (session === undefined) return <FullscreenMsg text="Loading..." />;
  if (!session || !profile) return <Login onSignedIn={() => {}} />;

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: paper, fontFamily: "Inter, sans-serif", color: ink }}>
      <Sidebar
        profile={profile}
        view={view}
        setView={setView}
        activeLocation={activeLocation}
        setActiveLocation={setActiveLocation}
        onSignOut={() => supabase.auth.signOut()}
      />
      <main style={{ flex: 1, padding: "40px 44px", minWidth: 0 }}>
        {view === "dashboard" && profile.role === "manager" && (
          <Dashboard sales={sales} onOpenLocation={(loc) => { setActiveLocation(loc); setView("location"); }} />
        )}
        {view === "location" && (
          <LocationView location={activeLocation} sales={sales} profile={profile} onLogSale={() => setShowLogModal(true)} />
        )}
        {view === "reports" && profile.role === "manager" && <Reports sales={sales} />}
        {view === "staff" && profile.role === "manager" && <StaffView sales={sales} />}
      </main>
      {showLogModal && (
        <LogSaleModal
          location={activeLocation}
          profile={profile}
          onClose={() => setShowLogModal(false)}
          onSubmit={async (entry) => { await addSale(entry); setShowLogModal(false); }}
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
  const [mode, setMode] = useState("signin"); // signin | signup
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [location, setLocation] = useState(LOCATIONS[0]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

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
    // profile row is created automatically by a database trigger with role 'staff'.
    // set their chosen location.
    if (data.user) {
      await supabase.from("profiles").update({ location }).eq("id", data.user.id);
    }
    setBusy(false);
  }

  return (
    <div style={{ minHeight: "100vh", background: ink, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Inter, sans-serif" }}>
      <div style={{ width: 380, background: paper, borderRadius: 4, padding: "40px 36px", border: `1px solid ${cardBorder}` }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 6 }}>
          <span style={{ fontFamily: "Fraunces, serif", fontSize: 26, fontWeight: 600, color: ink }}>Shutter</span>
          <span style={{ fontFamily: "Fraunces, serif", fontSize: 26, fontWeight: 300, color: gold, fontStyle: "italic" }}>Ledger</span>
        </div>
        <p style={{ color: inkSoft, fontSize: 13.5, marginBottom: 24, lineHeight: 1.5 }}>Photo sales, tracked by location.</p>

        <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
          <button onClick={() => setMode("signin")} style={tabStyle(mode === "signin")}>Sign in</button>
          <button onClick={() => setMode("signup")} style={tabStyle(mode === "signup")}>New staff account</button>
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
            padding: "11px 0",
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
const inputStyle = { width: "100%", padding: "10px 12px", borderRadius: 3, border: `1px solid ${cardBorder}`, marginBottom: 16, fontSize: 14, background: "#fff", boxSizing: "border-box" };
function tabStyle(active) {
  return {
    flex: 1,
    padding: "9px 0",
    fontSize: 12.5,
    borderRadius: 3,
    border: `1px solid ${active ? ink : cardBorder}`,
    background: active ? ink : "transparent",
    color: active ? paper : inkSoft,
    cursor: "pointer",
  };
}

function Sidebar({ profile, view, setView, activeLocation, setActiveLocation, onSignOut }) {
  const navItemStyle = (active) => ({
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "9px 14px",
    borderRadius: 3,
    fontSize: 13.5,
    color: active ? paper : "#9FAEA8",
    background: active ? "rgba(200,155,60,0.16)" : "transparent",
    borderLeft: active ? `2px solid ${gold}` : "2px solid transparent",
    cursor: "pointer",
    marginBottom: 2,
  });

  return (
    <aside style={{ width: 220, background: ink, padding: "26px 16px", display: "flex", flexDirection: "column", flexShrink: 0 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6, padding: "0 6px", marginBottom: 30 }}>
        <span style={{ fontFamily: "Fraunces, serif", fontSize: 18, fontWeight: 600, color: paper }}>Shutter</span>
        <span style={{ fontFamily: "Fraunces, serif", fontSize: 18, fontWeight: 300, fontStyle: "italic", color: gold }}>Ledger</span>
      </div>

      {profile.role === "manager" && (
        <div onClick={() => setView("dashboard")} style={navItemStyle(view === "dashboard")}>
          <LayoutGrid size={15} /> Dashboard
        </div>
      )}

      <div style={{ marginTop: 10, marginBottom: 4, padding: "0 14px", fontSize: 11, color: "#6E7D77" }}>Locations</div>
      {(profile.role === "manager" ? LOCATIONS : [profile.location]).filter(Boolean).map((loc) => (
        <div key={loc} onClick={() => { setActiveLocation(loc); setView("location"); }} style={navItemStyle(view === "location" && activeLocation === loc)}>
          <MapPin size={15} /> {loc}
        </div>
      ))}

      {profile.role === "manager" && (
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
          <div style={{ color: "#8A9891", fontSize: 12 }}>{profile.role === "manager" ? "Manager · all locations" : profile.location}</div>
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
    <div style={{ background: "#fff", border: `1px solid ${cardBorder}`, borderRadius: 4, padding: "16px 18px", flex: 1 }}>
      <div style={{ fontSize: 12, color: inkSoft, marginBottom: 8 }}>{label}</div>
      <div style={{ fontFamily: "Fraunces, serif", fontSize: 24, fontWeight: 600, color: tint || ink }}>{value}</div>
    </div>
  );
}

function Dashboard({ sales, onOpenLocation }) {
  const totals = useMemo(() => {
    const byLoc = {};
    LOCATIONS.forEach((l) => (byLoc[l] = { cash: 0, card: 0, count: 0 }));
    sales.forEach((s) => {
      if (!byLoc[s.location]) return;
      byLoc[s.location][s.method] += Number(s.amount);
      byLoc[s.location].count += 1;
    });
    return byLoc;
  }, [sales]);

  const grandTotal = sales.reduce((sum, s) => sum + Number(s.amount), 0);
  const cashTotal = sales.filter((s) => s.method === "cash").reduce((sum, s) => sum + Number(s.amount), 0);
  const cardTotal = sales.filter((s) => s.method === "card").reduce((sum, s) => sum + Number(s.amount), 0);
  const maxVal = Math.max(1, ...LOCATIONS.map((l) => totals[l].cash + totals[l].card));

  return (
    <div>
      <h1 style={{ fontFamily: "Fraunces, serif", fontSize: 28, fontWeight: 600, margin: 0 }}>Dashboard</h1>
      <p style={{ color: inkSoft, fontSize: 13.5, marginTop: 4, marginBottom: 26 }}>Photo sales across all locations, live.</p>

      <div style={{ display: "flex", gap: 14, marginBottom: 28 }}>
        <StatCard label="Total sales" value={fmtAED(grandTotal)} />
        <StatCard label="Cash collected" value={fmtAED(cashTotal)} tint={teal} />
        <StatCard label="Card collected" value={fmtAED(cardTotal)} tint={coral} />
        <StatCard label="Entries logged" value={sales.length} />
      </div>

      <div style={{ background: "#fff", border: `1px solid ${cardBorder}`, borderRadius: 4, padding: "20px 22px", marginBottom: 22 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 18 }}>Radisson vs Harbour vs Five Hotels</div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 40, height: 160, paddingLeft: 4 }}>
          {LOCATIONS.map((loc) => {
            const t = totals[loc];
            const h = ((t.cash + t.card) / maxVal) * 140;
            return (
              <div key={loc} style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 70 }}>
                <div style={{ fontSize: 11.5, color: inkSoft, marginBottom: 6 }}>{fmtAED(t.cash + t.card)}</div>
                <div style={{ width: 46, height: Math.max(h, 2), display: "flex", flexDirection: "column-reverse", borderRadius: "2px 2px 0 0", overflow: "hidden" }}>
                  <div style={{ height: `${t.card ? (t.card / (t.cash + t.card || 1)) * 100 : 0}%`, background: coral }} />
                  <div style={{ flex: 1, background: teal }} />
                </div>
                <div style={{ fontSize: 12.5, marginTop: 8 }}>{loc}</div>
              </div>
            );
          })}
        </div>
        <div style={{ display: "flex", gap: 18, marginTop: 16, fontSize: 12, color: inkSoft }}>
          <span><span style={{ display: "inline-block", width: 9, height: 9, background: teal, borderRadius: 2, marginRight: 6 }} />Cash</span>
          <span><span style={{ display: "inline-block", width: 9, height: 9, background: coral, borderRadius: 2, marginRight: 6 }} />Card</span>
        </div>
      </div>

      <div style={{ display: "flex", gap: 14 }}>
        {LOCATIONS.map((loc) => (
          <div key={loc} onClick={() => onOpenLocation(loc)} style={{ flex: 1, background: "#fff", border: `1px solid ${cardBorder}`, borderRadius: 4, padding: "16px 18px", cursor: "pointer" }}>
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

function LocationView({ location, sales, profile, onLogSale }) {
  const entries = sales.filter((s) => s.location === location);
  const total = entries.reduce((sum, s) => sum + Number(s.amount), 0);
  const cash = entries.filter((s) => s.method === "cash").reduce((sum, s) => sum + Number(s.amount), 0);
  const card = entries.filter((s) => s.method === "card").reduce((sum, s) => sum + Number(s.amount), 0);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [thumbs, setThumbs] = useState({});

  useEffect(() => {
    const paths = entries.filter((e) => e.card_photo_path).map((e) => e.card_photo_path);
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
  }, [entries.length]);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h1 style={{ fontFamily: "Fraunces, serif", fontSize: 28, fontWeight: 600, margin: 0 }}>{location}</h1>
          <p style={{ color: inkSoft, fontSize: 13.5, marginTop: 4 }}>Sales log for this location.</p>
        </div>
        <button onClick={onLogSale} style={{ background: gold, border: "none", borderRadius: 3, padding: "10px 18px", fontWeight: 600, fontSize: 13.5, color: ink, cursor: "pointer" }}>
          + Log sale
        </button>
      </div>

      <div style={{ display: "flex", gap: 14, margin: "22px 0 26px" }}>
        <StatCard label="Total collected" value={fmtAED(total)} />
        <StatCard label="Cash" value={fmtAED(cash)} tint={teal} />
        <StatCard label="Card" value={fmtAED(card)} tint={coral} />
        <StatCard label="Entries" value={entries.length} />
      </div>

      <div style={{ background: "#fff", border: `1px solid ${cardBorder}`, borderRadius: 4, overflow: "hidden" }}>
        <div style={{ padding: "14px 20px", fontSize: 13.5, fontWeight: 600, borderBottom: `1px solid ${cardBorder}` }}>Sale history</div>
        {entries.length === 0 && <div style={{ padding: "30px 20px", color: inkSoft, fontSize: 13.5 }}>No sales logged yet for {location}.</div>}
        {entries.map((e) => (
          <div key={e.id} style={{ display: "flex", alignItems: "center", padding: "14px 20px", borderBottom: `1px solid ${cardBorder}`, gap: 14 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: e.method === "cash" ? teal : coral, flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 500 }}>{e.staff_username}</div>
              <div style={{ fontSize: 12, color: inkSoft }}>{fmtDate(e.created_at)} · {fmtTime(e.created_at)} · {e.method === "cash" ? "Cash" : "Credit card"}</div>
            </div>
            {e.method === "card" && e.card_photo_path && thumbs[e.card_photo_path] && (
              <img src={thumbs[e.card_photo_path]} onClick={() => setPreviewUrl(thumbs[e.card_photo_path])} style={{ width: 40, height: 26, objectFit: "cover", borderRadius: 3, cursor: "pointer", border: `1px solid ${cardBorder}` }} />
            )}
            <div style={{ fontFamily: "Fraunces, serif", fontSize: 16, fontWeight: 600, width: 110, textAlign: "right" }}>{fmtAED(e.amount)}</div>
          </div>
        ))}
      </div>

      {previewUrl && (
        <div onClick={() => setPreviewUrl(null)} style={{ position: "fixed", inset: 0, background: "rgba(20,36,32,0.85)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, cursor: "zoom-out" }}>
          <img src={previewUrl} style={{ maxWidth: "80%", maxHeight: "80%", borderRadius: 4 }} />
        </div>
      )}
    </div>
  );
}

function LogSaleModal({ location, profile, onClose, onSubmit }) {
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("cash");
  const [cardFile, setCardFile] = useState(null);
  const [cardPreview, setCardPreview] = useState(null);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef(null);

  function handleFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    setCardFile(file);
    setCardPreview(URL.createObjectURL(file));
  }

  const canSubmit = amount && Number(amount) > 0 && (method === "cash" || (method === "card" && cardFile)) && !saving;

  async function handleSave() {
    setSaving(true);
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
    await onSubmit({
      location,
      staff_username: profile.username,
      amount: Number(amount),
      method,
      card_photo_path,
    });
    setSaving(false);
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(20,36,32,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 40 }}>
      <div style={{ width: 400, background: paper, borderRadius: 4, padding: "26px 26px 22px", border: `1px solid ${cardBorder}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <div style={{ fontFamily: "Fraunces, serif", fontSize: 19, fontWeight: 600 }}>Log a sale</div>
          <X size={18} onClick={onClose} style={{ cursor: "pointer", color: inkSoft }} />
        </div>
        <div style={{ fontSize: 12.5, color: inkSoft, marginBottom: 20 }}>{location} · logged by {profile.username}</div>

        <label style={labelStyle}>Amount (AED)</label>
        <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" style={{ ...inputStyle, marginBottom: 18, fontSize: 15 }} />

        <label style={{ ...labelStyle, marginBottom: 7 }}>Payment method</label>
        <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
          <button onClick={() => setMethod("cash")} style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 7, padding: "10px 0", borderRadius: 3, border: `1px solid ${method === "cash" ? teal : cardBorder}`, background: method === "cash" ? "rgba(47,111,99,0.1)" : "#fff", color: method === "cash" ? teal : inkSoft, fontSize: 13.5, cursor: "pointer" }}>
            <Banknote size={15} /> Cash
          </button>
          <button onClick={() => setMethod("card")} style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 7, padding: "10px 0", borderRadius: 3, border: `1px solid ${method === "card" ? coral : cardBorder}`, background: method === "card" ? "rgba(190,90,62,0.1)" : "#fff", color: method === "card" ? coral : inkSoft, fontSize: 13.5, cursor: "pointer" }}>
            <CreditCard size={15} /> Credit card
          </button>
        </div>

        {method === "card" && (
          <div style={{ marginBottom: 20 }}>
            <label style={{ ...labelStyle, marginBottom: 7 }}>Photo of the card</label>
            {!cardPreview ? (
              <div onClick={() => fileRef.current.click()} style={{ border: `1px dashed ${cardBorder}`, borderRadius: 3, padding: "22px 0", textAlign: "center", cursor: "pointer", background: "#fff" }}>
                <Camera size={20} color={inkSoft} style={{ marginBottom: 6 }} />
                <div style={{ fontSize: 12.5, color: inkSoft }}>Take or upload a photo</div>
              </div>
            ) : (
              <div style={{ position: "relative" }}>
                <img src={cardPreview} style={{ width: "100%", height: 110, objectFit: "cover", borderRadius: 3, border: `1px solid ${cardBorder}` }} />
                <div onClick={() => { setCardFile(null); setCardPreview(null); }} style={{ position: "absolute", top: 6, right: 6, background: ink, borderRadius: "50%", width: 22, height: 22, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                  <X size={12} color={paper} />
                </div>
              </div>
            )}
            <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={handleFile} style={{ display: "none" }} />
          </div>
        )}

        <button
          disabled={!canSubmit}
          onClick={handleSave}
          style={{ width: "100%", padding: "11px 0", borderRadius: 3, border: "none", background: canSubmit ? gold : "#CFC6AE", color: ink, fontWeight: 600, fontSize: 14, cursor: canSubmit ? "pointer" : "not-allowed", display: "flex", alignItems: "center", justifyContent: "center", gap: 7 }}
        >
          <Check size={15} /> {saving ? "Saving..." : "Save sale"}
        </button>
      </div>
    </div>
  );
}

function Reports({ sales }) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const filtered = sales.filter((s) => {
    const t = new Date(s.created_at).getTime();
    if (from && t < new Date(from).getTime()) return false;
    if (to && t > new Date(to).getTime() + 86400000) return false;
    return true;
  });

  function exportCSV() {
    const rows = [["Date", "Time", "Location", "Staff", "Amount (AED)", "Method", "Card photo attached"]];
    filtered.forEach((s) => {
      rows.push([fmtDate(s.created_at), fmtTime(s.created_at), s.location, s.staff_username, Number(s.amount).toFixed(2), s.method, s.card_photo_path ? "Yes" : "No"]);
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
      <h1 style={{ fontFamily: "Fraunces, serif", fontSize: 28, fontWeight: 600, margin: 0 }}>Reports</h1>
      <p style={{ color: inkSoft, fontSize: 13.5, marginTop: 4, marginBottom: 24 }}>Export the sales ledger for finance review.</p>

      <div style={{ display: "flex", gap: 10, alignItems: "flex-end", marginBottom: 24 }}>
        <div>
          <label style={labelStyle}>From</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ padding: "9px 10px", borderRadius: 3, border: `1px solid ${cardBorder}`, fontSize: 13.5, background: "#fff" }} />
        </div>
        <div>
          <label style={labelStyle}>To</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ padding: "9px 10px", borderRadius: 3, border: `1px solid ${cardBorder}`, fontSize: 13.5, background: "#fff" }} />
        </div>
        <button onClick={exportCSV} style={{ display: "flex", alignItems: "center", gap: 7, background: ink, color: paper, border: "none", borderRadius: 3, padding: "10px 16px", fontSize: 13.5, fontWeight: 600, cursor: "pointer" }}>
          <Download size={14} /> Export CSV
        </button>
      </div>
      <div style={{ fontSize: 12, color: inkSoft, marginBottom: 20 }}>Leave both dates blank to export full history. {filtered.length} entries in range.</div>

      <div style={{ display: "flex", gap: 14 }}>
        {LOCATIONS.map((loc) => {
          const e = filtered.filter((s) => s.location === loc);
          const total = e.reduce((sum, s) => sum + Number(s.amount), 0);
          return (
            <div key={loc} style={{ flex: 1, background: "#fff", border: `1px solid ${cardBorder}`, borderRadius: 4, padding: "16px 18px" }}>
              <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 8 }}>{loc}</div>
              <div style={{ fontFamily: "Fraunces, serif", fontSize: 19 }}>{fmtAED(total)}</div>
              <div style={{ fontSize: 12, color: inkSoft, marginTop: 4 }}>{e.length} entries</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StaffView({ sales }) {
  const [profiles, setProfiles] = useState([]);
  const [busyId, setBusyId] = useState(null);

  const loadProfiles = useCallback(() => {
    supabase.from("profiles").select("*").order("username").then(({ data }) => setProfiles(data || []));
  }, []);

  useEffect(() => { loadProfiles(); }, [loadProfiles]);

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
    await supabase.from("profiles").update(fields).eq("id", id);
    await loadProfiles();
    setBusyId(null);
  }

  return (
    <div>
      <h1 style={{ fontFamily: "Fraunces, serif", fontSize: 28, fontWeight: 600, margin: 0 }}>Staff</h1>
      <p style={{ color: inkSoft, fontSize: 13.5, marginTop: 4, marginBottom: 24 }}>
        Everyone who has an account. Reassign location or role here, and see totals collected for accountability.
      </p>

      <div style={{ background: "#fff", border: `1px solid ${cardBorder}`, borderRadius: 4, overflow: "hidden" }}>
        <div style={{ display: "flex", padding: "12px 20px", fontSize: 11.5, color: inkSoft, borderBottom: `1px solid ${cardBorder}` }}>
          <div style={{ flex: 1.4 }}>Username</div>
          <div style={{ flex: 1 }}>Role</div>
          <div style={{ flex: 1.2 }}>Location</div>
          <div style={{ flex: 1, textAlign: "right" }}>Cash</div>
          <div style={{ flex: 1, textAlign: "right" }}>Card</div>
          <div style={{ flex: 1, textAlign: "right" }}>Total</div>
        </div>
        {profiles.map((p) => {
          const t = totalsByUsername[p.username] || { total: 0, cash: 0, card: 0, count: 0 };
          return (
            <div key={p.id} style={{ display: "flex", padding: "12px 20px", fontSize: 13.5, borderBottom: `1px solid ${cardBorder}`, alignItems: "center", opacity: busyId === p.id ? 0.5 : 1 }}>
              <div style={{ flex: 1.4, fontWeight: 500 }}>{p.username}</div>
              <div style={{ flex: 1 }}>
                <select value={p.role} onChange={(e) => updateProfile(p.id, { role: e.target.value })} style={{ fontSize: 12.5, padding: "5px 6px", borderRadius: 3, border: `1px solid ${cardBorder}`, background: "#fff" }}>
                  <option value="staff">Staff</option>
                  <option value="manager">Manager</option>
                </select>
              </div>
              <div style={{ flex: 1.2 }}>
                <select value={p.location || ""} onChange={(e) => updateProfile(p.id, { location: e.target.value || null })} style={{ fontSize: 12.5, padding: "5px 6px", borderRadius: 3, border: `1px solid ${cardBorder}`, background: "#fff" }}>
                  <option value="">—</option>
                  {LOCATIONS.map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
              </div>
              <div style={{ flex: 1, textAlign: "right", color: teal }}>{fmtAED(t.cash)}</div>
              <div style={{ flex: 1, textAlign: "right", color: coral }}>{fmtAED(t.card)}</div>
              <div style={{ flex: 1, textAlign: "right", fontWeight: 600 }}>{fmtAED(t.total)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
