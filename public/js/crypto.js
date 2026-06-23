// ==================== CRYPTO (비밀번호 암호화) ====================
async function hashStr(str) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
}
async function hashAnswer(answer) {
    return hashStr(answer.toLowerCase().trim() + '|youthnaroo-answer');
}
async function deriveKey(answer) {
    const raw = await crypto.subtle.importKey('raw', new TextEncoder().encode(answer.toLowerCase().trim()), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name:'PBKDF2', salt: new TextEncoder().encode('youthnaroo-pwsalt'), iterations: 100000, hash:'SHA-256' }, raw, { name:'AES-GCM', length:256 }, false, ['encrypt','decrypt']);
}
async function encryptPassword(password, answer) {
    const key = await deriveKey(answer);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name:'AES-GCM', iv }, key, new TextEncoder().encode(password));
    const combined = new Uint8Array(12 + ct.byteLength);
    combined.set(iv); combined.set(new Uint8Array(ct), 12);
    return btoa(String.fromCharCode(...combined));
}
async function decryptPassword(enc, answer) {
    const key = await deriveKey(answer);
    const bytes = Uint8Array.from(atob(enc), c => c.charCodeAt(0));
    const iv = bytes.slice(0,12), ct = bytes.slice(12);
    const plain = await crypto.subtle.decrypt({ name:'AES-GCM', iv }, key, ct);
    return new TextDecoder().decode(plain);
}


export { hashStr, hashAnswer, deriveKey, encryptPassword, decryptPassword };
