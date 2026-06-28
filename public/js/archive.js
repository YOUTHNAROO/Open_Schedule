import { supabase } from './supabase.js';
import S from './state.js';
import { HOURS, ALL_ROOMS, FLOORS, DAYS } from './constants.js';
import { esc, getTeam } from './utils.js';
import { buildMergedReservations } from './ui.js';

// ==================== ARCHIVE VIEWER ====================
async function openArchiveViewer() {
    showModal('archive-modal');
    const sel = document.getElementById('archive-week-sel');
    if (!sel) return;
    sel.innerHTML = '<option value="">주차를 선택하세요</option>';
    try {
        const { data, error } = await supabase.from('archive').select('week_id').order('week_id', { ascending: false });
        if (error) throw error;
        (data || []).forEach(r => { sel.innerHTML += `<option value="${r.week_id}">${r.week_id}</option>`; });
    } catch { sel.innerHTML = '<option value="">로드 실패</option>'; }
}

async function loadArchiveData(weekId) {
    const container = document.getElementById('archive-content');
    if (!container) return;
    container.innerHTML = '<div class="text-center py-8 text-slate-400 text-sm animate-pulse">로딩 중...</div>';
    try {
        const { data, error } = await supabase.from('archive').select('*').eq('week_id', weekId).single();
        if (error || !data) { container.innerHTML = '<div class="text-center py-8 text-slate-400 text-sm">기록을 찾을 수 없습니다.</div>'; return; }
        renderArchiveGrid(container, data.data, weekId);
    } catch (e) { container.innerHTML = `<div class="text-center py-8 text-red-400 text-sm">${e.message}</div>`; }
}

function renderArchiveGrid(container, data, weekId) {
    let html = `<div class="mb-3 flex items-center justify-between"><span class="text-sm font-bold text-slate-700">${weekId} 예약 이력</span><button onclick="exportArchiveExcel('${weekId}')" class="flex items-center gap-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1.5 rounded-lg hover:bg-emerald-100 transition-all"><i data-lucide="download" class="w-3.5 h-3.5"></i> 엑셀 저장</button></div>`;
    DAYS.forEach(day => {
        const dd = data[day.id] || {};
        const hasData = Object.keys(dd).length > 0;
        html += `<div class="mb-5"><h4 class="text-xs font-bold text-slate-600 mb-2 flex items-center gap-1.5"><span class="w-2 h-2 rounded-full ${day.color} inline-block"></span>${day.fullLabel} ${hasData ? `<span class="text-[10px] font-normal text-slate-400">(${Object.keys(dd).length}건)</span>` : '<span class="text-[10px] text-slate-300">예약 없음</span>'}</h4>`;
        if (hasData) {
            html += `<div class="overflow-x-auto"><table class="w-full border-collapse text-[10px]" style="min-width:800px"><thead><tr class="bg-slate-100 border border-slate-200"><th class="py-1.5 px-2 border border-slate-200 font-bold text-slate-500 w-14">시간</th>${ALL_ROOMS.map(r => `<th class="py-1.5 px-2 border border-slate-200 font-bold text-slate-600 min-w-[75px]">${r}</th>`).join('')}</tr></thead><tbody>${HOURS.map(hour => { const row = `<tr class="border border-slate-100"><td class="py-1.5 px-2 border border-slate-200 font-bold text-slate-500 bg-slate-50">${hour}</td>${ALL_ROOMS.map(room => { const key = `${hour}-${room}`.replace(/\//g, '_'); const res = dd[key]; if (res) { const t = getTeam(res.team_id || res.teamId); return `<td class="py-1.5 px-2 border border-slate-200"><span class="px-1.5 py-0.5 rounded text-[9px] font-bold ${t ? `${t.bg} ${t.text}` : 'bg-slate-100 text-slate-600'}">${res.team_name || res.teamName}${(res.is_fixed || res.isFixed) ? ' 🔒' : ''}</span></td>`; } return `<td class="py-1.5 px-2 border border-slate-200 text-slate-200 text-center">·</td>` }).join('')}</tr>`; return row }).join('')}</tbody></table></div>`;
        }
        html += `</div>`;
    });
    container.innerHTML = html;
    lucide.createIcons();
}

window.exportArchiveExcel = async function (weekId) {
    showToast('엑셀 준비 중...', 'info');
    setTimeout(async () => {
        const { data, error } = await supabase.from('archive').select('*').eq('week_id', weekId).single();
        if (error || !data) { showToast('데이터 없음', 'error'); return; }
        const archiveData = data.data;
        const wb = XLSX.utils.book_new();
        DAYS.forEach(day => {
            const dd = archiveData[day.id] || {};
            const rows = [['시간', ...ALL_ROOMS]];
            HOURS.forEach(h => { rows.push([h, ...ALL_ROOMS.map(r => { const res = dd[`${h}-${r}`.replace(/\//g, '_')]; return res ? `${res.team_name || res.teamName}${(res.is_fixed || res.isFixed) ? ' (고정)' : ''}` : ''; })]); });
            const ws = XLSX.utils.aoa_to_sheet(rows);
            ws['!cols'] = [{ wch: 8 }, ...ALL_ROOMS.map(() => ({ wch: 14 }))];
            XLSX.utils.book_append_sheet(wb, ws, day.fullLabel);
        });
        XLSX.writeFile(wb, `유스나루_${weekId}.xlsx`);
        showToast('엑셀 다운로드 시작!', 'success');
    }, 100);
};

async function exportCurrentExcel() {
    showToast('엑셀 준비 중...', 'info');
    try {
        const wb = XLSX.utils.book_new();
        for (const day of DAYS) {
            const { data } = await supabase.from('reservations').select('*')
                .eq('week_id', S.currentWeekId).eq('day_id', day.id);
            const dd = {};
            (data || []).forEach(r => { dd[r.key] = r; });
            const df = S.fixedSchedules.filter(fs => fs.day === day.id);
            const merged = buildMergedReservations(dd, df);
            const rows = [['시간', ...ALL_ROOMS]];
            HOURS.forEach(h => { rows.push([h, ...ALL_ROOMS.map(r => { const res = merged[`${h}-${r}`.replace(/\//g, '_')]; return res ? `${res.teamName}${res.isFixed ? ' (고정)' : ''}` : ''; })]); });
            const ws = XLSX.utils.aoa_to_sheet(rows);
            ws['!cols'] = [{ wch: 8 }, ...ALL_ROOMS.map(() => ({ wch: 14 }))];
            XLSX.utils.book_append_sheet(wb, ws, day.fullLabel);
        }
        XLSX.writeFile(wb, `유스나루_예약현황_${S.currentWeekId}.xlsx`);
        showToast('엑셀 파일 다운로드!', 'success');
    } catch (e) {
        showToast('엑셀 다운로드 실패: ' + e.message, 'error');
    }
}

export { openArchiveViewer, loadArchiveData, renderArchiveGrid, exportCurrentExcel };
