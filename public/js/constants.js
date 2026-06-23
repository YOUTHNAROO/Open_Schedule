export const DAYS = [
    { id: 'mon', label: '월', fullLabel: '월요일', color: 'bg-slate-400' },
    { id: 'tue', label: '화', fullLabel: '화요일', color: 'bg-slate-400' },
    { id: 'wed', label: '수', fullLabel: '수요일', color: 'bg-slate-400' },
    { id: 'thu', label: '목', fullLabel: '목요일', color: 'bg-slate-400' },
    { id: 'fri', label: '금', fullLabel: '금요일', color: 'bg-slate-400' },
    { id: 'sat', label: '토', fullLabel: '토요일', color: 'bg-blue-500' },
    { id: 'sun', label: '일', fullLabel: '일요일', color: 'bg-red-500' },
];

export const HOURS = ['09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00', '21:00'];

export const FLOORS = [
    { id: 'f3', label: '3층', rooms: ['체육관'] },
    { id: 'b1', label: '지하 1층', rooms: ['건강나루', '피아노나루', '소리나루'] },
    { id: 'f1-program', label: '1층 프로그램실', rooms: ['상상나루', '생각나루', '창의나루', '세미나실', '키움나루', '사랑나루', '나루지기', '멀티미디어'] },
    { id: 'f1-comma', label: '1층 콤마', rooms: ['콤마', '콤마 스튜디오'] },
    { id: 'happy-school', label: '행복동행학교', rooms: ['링키', '행복나루', '동행나루'] },
    { id: 'after-school', label: '방과후아카데미', rooms: ['신나루', '빛나루'] },
    { id: 'f2-media', label: '2층 방송문화콘텐츠공작소', rooms: ['미디어나루', '방송나루', '스튜디오M', '스튜디오H'] }
];
export const ALL_ROOMS = FLOORS.flatMap(f => f.rooms);

export const DEFAULT_TEAMS = [
    { id: 'narujigi', name: '나루지기', fullType: '청소년운영위원회', schedule: '2,4,5주 토요일 14:00~17:00', typicalRooms: ['나루지기'], bg: 'bg-amber-100', text: 'text-amber-800', border: 'border-amber-300', hex: '#fef3c7', hexText: '#78350f' },
    { id: 'dahim', name: '다힘', fullType: '공연동아리연합회', schedule: '보통 평일 저녁, 주말 종일', typicalRooms: ['콤마 스튜디오', '소리나루', '스튜디오M'], bg: 'bg-sky-100', text: 'text-sky-800', border: 'border-sky-300', hex: '#e0f2fe', hexText: '#0c4a6e' },
    { id: 'story', name: '진로스토리텔러', fullType: '전문가 연합 활동단', schedule: '2,4주 토요일 14:00~17:00', typicalRooms: ['링키', '상상나루', '스튜디오M'], bg: 'bg-emerald-100', text: 'text-emerald-800', border: 'border-emerald-300', hex: '#d1fae5', hexText: '#064e3b' },
    { id: 'ynbc-univ', name: '대학생미디어', fullType: 'YNBC 대학생미디어활동단', schedule: '매주 금요일 14:00~17:00', typicalRooms: ['방송나루', '스튜디오M', '스튜디오H'], bg: 'bg-indigo-100', text: 'text-indigo-800', border: 'border-indigo-300', hex: '#e0e7ff', hexText: '#312e81' },
    { id: 'mascot', name: '마스코트', fullType: '마포구청소년축제기획단', schedule: '2,4주 토요일 14:00~17:00', typicalRooms: ['상상나루'], bg: 'bg-blue-100', text: 'text-blue-800', border: 'border-blue-300', hex: '#dbeafe', hexText: '#1e3a5f' },
    { id: 'mulyuol', name: '물여울', fullType: '수영동아리', schedule: '매주 토요일 09:00~11:00', typicalRooms: ['건강나루'], bg: 'bg-cyan-100', text: 'text-cyan-800', border: 'border-cyan-300', hex: '#cffafe', hexText: '#0e7490' },
    { id: 'halftime', name: '하프타임', fullType: '농구동아리', schedule: '매주 토요일 15:00~17:00', typicalRooms: ['체육관'], bg: 'bg-orange-100', text: 'text-orange-800', border: 'border-orange-300', hex: '#ffedd5', hexText: '#7c2d12' },
    { id: 'ynbc', name: '청소년방송국', fullType: 'YNBC 유스나루청소년방송국', schedule: '1,3주 토요일 14:00~17:00', typicalRooms: ['방송나루', '스튜디오M', '스튜디오H'], bg: 'bg-purple-100', text: 'text-purple-800', border: 'border-purple-300', hex: '#f3e8ff', hexText: '#581c87' },
];
