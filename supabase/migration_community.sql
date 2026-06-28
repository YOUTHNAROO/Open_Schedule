-- youthnaroo: 부서/표시명/청소년·직원 기능 + 데이터 통일을 위한 스키마 추가
-- Supabase SQL Editor에서 1회 실행. 모두 IF NOT EXISTS / 멱등.

-- 1) 활동단(teams)에 하위 부서 설정 + 약어 추가
--    dept_config = { "enabled": bool, "list": ["부서A","부서B", ...] }
alter table public.teams
  add column if not exists dept_config jsonb not null default '{"enabled":false,"list":[]}'::jsonb;
alter table public.teams
  add column if not exists short_name text;
-- (선택) 활동단 리더/슬랙 알림 기능을 쓰려면 아래 컬럼 필요. 없으면 admin이 자동으로 빼고 저장함.
alter table public.teams
  add column if not exists leader_ids jsonb not null default '[]'::jsonb;
alter table public.teams
  add column if not exists slack_webhook_url text;

-- 2) 초대코드(invite_codes)에 메타 추가
--    meta = { "name": 이름, "userType": "youth"|"staff", "department": 부서, "deptEnabled": bool }
alter table public.invite_codes
  add column if not exists meta jsonb not null default '{}'::jsonb;

-- (참고) app_users.data(jsonb)에 department, userType, photoUrl, communityNickname,
--        communityPhotoUrl, securityQuestion 등을 저장하므로 추가 컬럼 불필요.

-- 3) (선택) invite_codes에 created_at 기본값이 없다면 보강
alter table public.invite_codes
  alter column created_at set default now();

-- 4) (선택) 인덱스: 사용자 username 조회 가속
create index if not exists app_users_username_idx on public.app_users (username);
create index if not exists invite_codes_code_idx on public.invite_codes (code);
