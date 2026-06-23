import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
    window.ENV.SUPABASE_URL,
    window.ENV.SUPABASE_ANON_KEY
);

// ── 헬퍼: Firestore onSnapshot 대체 ──────────────────────────────
// subscribeTable(table, filter, callback)
// filter: { column, value } | null (전체 구독)
// callback: (rows) => void
function subscribeTable(table, filter, callback) {
    let channel = supabase.channel(`rt-${table}-${filter ? filter.value : 'all'}`);
    const opts = { event: '*', schema: 'public', table };
    if (filter) opts.filter = `${filter.column}=eq.${filter.value}`;
    channel = channel.on('postgres_changes', opts, async () => {
        const rows = await fetchAll(table, filter);
        callback(rows);
    });
    channel.subscribe();
    // 최초 1회 로드
    fetchAll(table, filter).then(callback);
    return () => supabase.removeChannel(channel);
}

async function fetchAll(table, filter) {
    let q = supabase.from(table).select('*');
    if (filter) q = q.eq(filter.column, filter.value);
    const { data, error } = await q.order('created_at', { ascending: true }).limit(1000);
    if (error) { console.error(`fetchAll ${table}:`, error); return []; }
    return data || [];
}

// ── CRUD 헬퍼 ────────────────────────────────────────────────────
async function dbInsert(table, row) {
    const { data, error } = await supabase.from(table).insert(row).select().single();
    if (error) throw error;
    return data;
}

async function dbUpsert(table, row, onConflict) {
    const opts = onConflict ? { onConflict } : {};
    const { data, error } = await supabase.from(table).upsert(row, opts).select().single();
    if (error) throw error;
    return data;
}

async function dbUpdate(table, match, updates) {
    let q = supabase.from(table).update(updates);
    for (const [col, val] of Object.entries(match)) q = q.eq(col, val);
    const { error } = await q;
    if (error) throw error;
}

async function dbDelete(table, match) {
    let q = supabase.from(table).delete();
    for (const [col, val] of Object.entries(match)) q = q.eq(col, val);
    const { error } = await q;
    if (error) throw error;
}

async function dbGet(table, match) {
    let q = supabase.from(table).select('*');
    for (const [col, val] of Object.entries(match)) q = q.eq(col, val);
    const { data, error } = await q.single();
    if (error && error.code !== 'PGRST116') throw error;
    return data || null;
}

async function dbGetMany(table, match, opts = {}) {
    let q = supabase.from(table).select('*');
    for (const [col, val] of Object.entries(match)) q = q.eq(col, val);
    if (opts.orderBy) q = q.order(opts.orderBy, { ascending: opts.asc ?? true });
    if (opts.limit) q = q.limit(opts.limit);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
}

export {
    supabase,
    subscribeTable,
    fetchAll,
    dbInsert,
    dbUpsert,
    dbUpdate,
    dbDelete,
    dbGet,
    dbGetMany,
};
