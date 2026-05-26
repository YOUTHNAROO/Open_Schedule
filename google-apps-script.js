/**
 * 마포청소년센터 유스나루 예약 시스템 - 구글 스프레드시트 연동 Apps Script
 * 
 * ⚠️ 적용 방법:
 * 1. 연동할 구글 스프레드시트에서 [확장 프로그램] -> [Apps Script]로 진입합니다.
 * 2. 기존 코드를 모두 지우고 이 스크립트 내용을 복사해서 붙여넣습니다.
 * 3. 코드 내의 `PROJECT_ID` 및 `SECRET_API_TOKEN` 값을 본인의 Firebase 프로젝트에 맞춰 설정합니다.
 * 4. 상단 메뉴에서 [배포] -> [새 배포]를 클릭합니다.
 *    - 유형: 웹 앱
 *    - 설명: 유스나루 예약 연동
 *    - 웹 앱을 실행할 사용자: 나 (스프레드시트 소유자 계정)
 *    - 액세스 권한이 있는 사용자: 모든 사용자 (Anonymous 포함 - 웹페이지에서 API 호출을 받기 위함)
 * 5. 배포 완료 후 생성된 [웹 앱 URL]을 복사하여 유스나루 관리자 페이지의 구글 시트 연동 설정에 입력합니다.
 */

// 🔧 환경 설정 (본인의 Firebase 정보로 변경하세요)
var PROJECT_ID = "youthnarooschedule"; // Firebase 프로젝트 ID
var SECRET_API_TOKEN = "youthnaroo_secret_token_2026"; // 보안용 API 비밀 토큰 (웹앱과 동일해야 함)

// 1. 웹 예약페이지에서 예약/취소 발생 시 시트에 반영 (doPost)
function doPost(e) {
  try {
    var params = e.parameter;
    if (!params.action || !params.day || !params.time || !params.room) {
      // JSON payload로 왔을 경우 파싱 시도
      if (e.postData && e.postData.contents) {
        params = JSON.parse(e.postData.contents);
      }
    }
    
    var action = params.action; // 'reserve' | 'cancel'
    var day = params.day;       // '월요일', '화요일', '수요일' 등
    var time = params.time;     // '09:00~09:50' 등
    var room = params.room;     // '체육관', '소리나루' 등
    var teamName = params.teamName || "";
    var userName = params.userName || "";
    var note = params.note || "";
    var activeTabName = params.activeTabName || getActiveTabFromFirebase() || "2026년 6월";
    
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(activeTabName);
    if (!sheet) {
      return ContentService.createTextOutput(JSON.stringify({ status: "error", message: "시트 '" + activeTabName + "'를 찾을 수 없습니다." }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    // 시트에서 요일 영역 찾기
    var lastRow = sheet.getLastRow();
    var lastColumn = sheet.getLastColumn();
    var data = sheet.getRange(1, 1, lastRow, lastColumn).getValues();
    
    var startRowIdx = -1;
    var endRowIdx = -1;
    
    // 1. 해당 요일의 시작 행과 끝 행 범위 탐색
    for (var i = 0; i < data.length; i++) {
      var rowStr = data[i].join(" ");
      if (rowStr.indexOf(day) !== -1) {
        startRowIdx = i + 1; // 1-indexed row number
        // 다음 요일 시작 부분을 찾기 전까지 범위를 잡음
        for (var j = i + 1; j < data.length; j++) {
          var nextRowStr = data[j].join(" ");
          // '요일' 단어가 행에 들어있고, 그것이 헤더성 구분자일 경우
          if (nextRowStr.indexOf("요일") !== -1 && (nextRowStr.indexOf("년") !== -1 || nextRowStr.indexOf("월") !== -1)) {
            endRowIdx = j;
            break;
          }
        }
        if (endRowIdx === -1) endRowIdx = lastRow;
        break;
      }
    }
    
    if (startRowIdx === -1) {
      return ContentService.createTextOutput(JSON.stringify({ status: "error", message: "요일 '" + day + "' 섹션을 시트에서 찾을 수 없습니다." }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    // 2. 해당 요일 범위 내에서 공간(방) 열(Column) 인덱스 탐색 (방 이름은 요일 구분 행 바로 다음다음 행인 3번째 줄 혹은 헤더 영역에 존재)
    var roomColIdx = -1;
    // startRowIdx 바로 다음 1~3행 내에서 방 이름 열을 찾음
    for (var r = startRowIdx; r < startRowIdx + 4; r++) {
      if (r > lastRow) break;
      var headerRow = data[r - 1];
      for (var c = 0; c < headerRow.length; c++) {
        var cellVal = String(headerRow[c]).replace(/\s+/g, "");
        var targetRoom = room.replace(/\s+/g, "");
        // 방 이름 매칭 (예: '소리나루(12명)' 안에 '소리나루'가 포함되는지)
        if (cellVal && (cellVal.indexOf(targetRoom) !== -1 || targetRoom.indexOf(cellVal) !== -1)) {
          roomColIdx = c + 1; // 1-indexed
          break;
        }
      }
      if (roomColIdx !== -1) break;
    }
    
    if (roomColIdx === -1) {
      return ContentService.createTextOutput(JSON.stringify({ status: "error", message: "공간 '" + room + "' 열을 찾을 수 없습니다." }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    // 3. 해당 요일 범위 내에서 시간(Time) 행(Row) 인덱스 탐색
    var targetRowIdx = -1;
    for (var r = startRowIdx; r <= endRowIdx; r++) {
      var cellVal = String(data[r - 1][0]).replace(/\s+/g, ""); // A열은 시간대
      var targetTime = time.replace(/\s+/g, "");
      if (cellVal && (cellVal.indexOf(targetTime) !== -1 || targetTime.indexOf(cellVal) !== -1)) {
        targetRowIdx = r;
        break;
      }
    }
    
    if (targetRowIdx === -1) {
      return ContentService.createTextOutput(JSON.stringify({ status: "error", message: "시간대 '" + time + "' 행을 찾을 수 없습니다." }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    // 4. 셀 내용 업데이트
    var cell = sheet.getRange(targetRowIdx, roomColIdx);
    if (action === "reserve") {
      var displayText = teamName;
      if (userName && userName !== "외부예약") {
        displayText += " (" + userName;
        if (note) {
          displayText += " - " + note;
        }
        displayText += ")";
      } else if (note) {
        displayText += " (" + note + ")";
      }
      cell.setValue(displayText);
    } else {
      cell.clearContent(); // 취소 시 셀 비움
    }
    
    return ContentService.createTextOutput(JSON.stringify({ status: "success", info: "시트 연동 완료" }))
      .setMimeType(ContentService.MimeType.JSON);
      
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ status: "error", message: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// 웹앱 doGet 호출 시 스프레드시트 데이터 전체를 긁어 정규화된 JSON으로 반환
function doGet(e) {
  try {
    var activeTabName = e.parameter.activeTabName || getActiveTabFromFirebase() || "2026년 6월";
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(activeTabName);
    if (!sheet) {
      return ContentService.createTextOutput(JSON.stringify({ error: "시트를 찾을 수 없습니다." }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    var lastRow = sheet.getLastRow();
    var lastColumn = sheet.getLastColumn();
    var data = sheet.getRange(1, 1, lastRow, lastColumn).getValues();
    
    var result = {
      sheetName: activeTabName,
      reservations: []
    };
    
    var currentDay = "";
    var rooms = [];
    var dayStartRow = -1;
    
    for (var i = 0; i < data.length; i++) {
      var row = data[i];
      var firstCell = String(row[0]).trim();
      var rowStr = row.join(" ");
      
      // 요일 구분 행 발견 (예: 2026년 6월 월요일)
      if (rowStr.indexOf("요일") !== -1 && (rowStr.indexOf("년") !== -1 || rowStr.indexOf("월") !== -1)) {
        // 기존 요일의 방 정보 매칭 행 분석
        currentDay = "";
        if (rowStr.indexOf("월요일") !== -1) currentDay = "월요일";
        else if (rowStr.indexOf("화요일") !== -1) currentDay = "화요일";
        else if (rowStr.indexOf("수요일") !== -1) currentDay = "수요일";
        else if (rowStr.indexOf("목요일") !== -1) currentDay = "목요일";
        else if (rowStr.indexOf("금요일") !== -1) currentDay = "금요일";
        else if (rowStr.indexOf("토요일") !== -1) currentDay = "토요일";
        else if (rowStr.indexOf("일요일") !== -1) currentDay = "일요일";
        
        dayStartRow = i;
        rooms = [];
        
        // 요일 행 다음 1~3행에서 방 이름 추출
        var headerSearchLimit = Math.min(i + 4, data.length);
        for (var hIdx = i + 1; hIdx < headerSearchLimit; hIdx++) {
          var hRow = data[hIdx];
          var hasRooms = false;
          var tempRooms = [];
          for (var c = 1; c < hRow.length; c++) {
            var val = String(hRow[c]).trim();
            tempRooms.push(val);
            if (val && val !== "1월" && val !== "2월" && val !== "12월") { // 월별 헤더 제외
              hasRooms = true;
            }
          }
          if (hasRooms) {
            // 정규 방 이름 리스트로 확정
            rooms = tempRooms;
          }
        }
        continue;
      }
      
      // 시간표 행 발견 (A열이 '09:00~09:50' 과 같은 포맷인 경우)
      if (currentDay && firstCell && firstCell.indexOf(":") !== -1 && firstCell.indexOf("~") !== -1) {
        var timeSlot = firstCell;
        for (var colIdx = 1; colIdx < row.length; colIdx++) {
          var cellContent = String(row[colIdx]).trim();
          var roomName = rooms[colIdx - 1] || "";
          
          if (cellContent && roomName) {
            // 방 이름의 정원 부분 제거 (예: '소리나루(12명)' -> '소리나루')
            roomName = roomName.split("(")[0].trim();
            
            // 셀 내용 파싱: 활동단명 (예약자명 - 메모)
            var parsed = parseCellContent(cellContent);
            
            result.reservations.push({
              day: currentDay,
              time: timeSlot,
              room: roomName,
              teamName: parsed.teamName,
              userName: parsed.userName,
              note: parsed.note
            });
          }
        }
      }
    }
    
    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
      
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ error: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// 셀 내용 파싱 헬퍼 함수
function parseCellContent(text) {
  var teamName = text;
  var userName = "외부예약";
  var note = "";
  
  // 1. 괄호가 있는지 확인: 활동단명 (예약자 - 메모)
  var bracketIdx = text.indexOf("(");
  if (bracketIdx !== -1) {
    teamName = text.substring(0, bracketIdx).trim();
    var innerText = text.substring(bracketIdx + 1, text.lastIndexOf(")")).trim();
    
    // 대시(-)로 메모 분리 여부 확인
    var dashIdx = innerText.indexOf("-");
    if (dashIdx !== -1) {
      userName = innerText.substring(0, dashIdx).trim();
      note = innerText.substring(dashIdx + 1).trim();
    } else {
      userName = innerText;
    }
  }
  
  return {
    teamName: teamName,
    userName: userName,
    note: note
  };
}

// 2. 시트 내용 직접 편집 시 Firestore에 실시간 반영 (onEdit Trigger)
function onEdit(e) {
  var range = e.range;
  var sheet = range.getSheet();
  var activeTabName = getActiveTabFromFirebase() || "2026년 6월";
  
  if (sheet.getName() !== activeTabName) return; // 활성 탭이 아니면 패스
  
  var rowIdx = range.getRow();
  var colIdx = range.getColumn();
  var newValue = range.getValue().toString().trim();
  
  // A열(시간대)이나 1~4행(헤더영역)을 수정한 경우 스킵
  if (colIdx === 1 || rowIdx < 5) return;
  
  var lastRow = sheet.getLastRow();
  var lastColumn = sheet.getLastColumn();
  var data = sheet.getRange(1, 1, lastRow, lastColumn).getValues();
  
  // 해당 셀의 요일, 시간대, 공간명 찾기
  var day = "";
  var time = "";
  var room = "";
  var rooms = [];
  
  // 1. 요일 식별 (현재 행에서 위로 올라가며 요일 구분자를 찾음)
  var dayStartRow = -1;
  for (var r = rowIdx; r > 0; r--) {
    var rStr = data[r - 1].join(" ");
    if (rStr.indexOf("요일") !== -1 && (rStr.indexOf("년") !== -1 || rStr.indexOf("월") !== -1)) {
      dayStartRow = r;
      if (rStr.indexOf("월요일") !== -1) day = "월요일";
      else if (rStr.indexOf("화요일") !== -1) day = "화요일";
      else if (rStr.indexOf("수요일") !== -1) day = "수요일";
      else if (rStr.indexOf("목요일") !== -1) day = "목요일";
      else if (rStr.indexOf("금요일") !== -1) day = "금요일";
      else if (rStr.indexOf("토요일") !== -1) day = "토요일";
      else if (rStr.indexOf("일요일") !== -1) day = "일요일";
      break;
    }
  }
  
  if (!day || dayStartRow === -1) return;
  
  // 2. 공간명 식별 (요일 시작 행 바로 밑의 방 목록을 스캔)
  var headerSearchLimit = Math.min(dayStartRow + 4, data.length);
  for (var hIdx = dayStartRow; hIdx < headerSearchLimit; hIdx++) {
    var hRow = data[hIdx];
    var hasRooms = false;
    var tempRooms = [];
    for (var c = 1; c < hRow.length; c++) {
      var val = String(hRow[c]).trim();
      tempRooms.push(val);
      if (val && val !== "1월" && val !== "2월" && val !== "12월") {
        hasRooms = true;
      }
    }
    if (hasRooms) {
      rooms = tempRooms;
    }
  }
  
  room = rooms[colIdx - 2] || "";
  if (!room) return;
  room = room.split("(")[0].trim(); // 정원 제거
  
  // 3. 시간대 식별
  time = data[rowIdx - 1][0].toString().trim();
  if (time.indexOf(":") === -1 || time.indexOf("~") === -1) return; // 유효한 시간대가 아님
  
  // Firestore REST API를 쏘기 위한 Payload 빌드
  var weekId = "current_week"; // 예약표 주차 구분 ID (기본값)
  var dayId = getDayId(day);
  var resId = time + "-" + room;
  
  // Firestore 문서 업데이트 URL
  var url = "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID + "/databases/(default)/documents/reservations/" + weekId + "/" + dayId + "/" + resId;
  
  var options = {
    method: "patch",
    contentType: "application/json",
    muteHttpExceptions: true
  };
  
  if (newValue === "") {
    // 셀이 지워진 경우 -> 빈 예약(취소)으로 데이터 업데이트 (보안 토큰 포함)
    var payload = {
      fields: {
        apiToken: { stringValue: SECRET_API_TOKEN },
        teamId: { nullValue: null }, // teamId가 null이면 예약 취소로 웹앱이 해석함
        teamName: { stringValue: "" },
        userName: { stringValue: "" },
        note: { stringValue: "" }
      }
    };
    options.payload = JSON.stringify(payload);
    UrlFetchApp.fetch(url + "?updateMask.fieldPaths=apiToken&updateMask.fieldPaths=teamId&updateMask.fieldPaths=teamName&updateMask.fieldPaths=userName&updateMask.fieldPaths=note", options);
  } else {
    // 셀에 예약 정보가 채워진 경우
    var parsed = parseCellContent(newValue);
    var payload = {
      fields: {
        apiToken: { stringValue: SECRET_API_TOKEN },
        teamId: { stringValue: getTeamIdByName(parsed.teamName) || "external" },
        teamName: { stringValue: parsed.teamName },
        userName: { stringValue: parsed.userName },
        note: { stringValue: parsed.note }
      }
    };
    options.payload = JSON.stringify(payload);
    UrlFetchApp.fetch(url + "?updateMask.fieldPaths=apiToken&updateMask.fieldPaths=teamId&updateMask.fieldPaths=teamName&updateMask.fieldPaths=userName&updateMask.fieldPaths=note", options);
  }
}

// 요일 텍스트를 dayId로 변경
function getDayId(dayText) {
  var map = { "월요일": "mon", "화요일": "tue", "수요일": "wed", "목요일": "thu", "금요일": "fri", "토요일": "sat", "일요일": "sun" };
  return map[dayText] || "mon";
}

// 활동단명으로 등록된 ID 매치 시도 (임의 지정 가능)
function getTeamIdByName(name) {
  var map = {
    "나루지기": "narui",
    "다힘": "dahim",
    "진로스토리텔러": "story",
    "대학생미디어": "ynbc-univ",
    "마스코트": "mascot",
    "물여울": "mulyuol",
    "하프타임": "halftime",
    "청소년방송국": "ynbc"
  };
  return map[name] || "external";
}

// Firestore에서 활성 탭 이름을 실시간 조회
function getActiveTabFromFirebase() {
  try {
    var url = "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID + "/databases/(default)/documents/system_settings/google_sheets";
    var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (res.getResponseCode() === 200) {
      var json = JSON.parse(res.getContentText());
      if (json.fields && json.fields.activeTabName) {
        return json.fields.activeTabName.stringValue;
      }
    }
  } catch(e) {}
  return null;
}
