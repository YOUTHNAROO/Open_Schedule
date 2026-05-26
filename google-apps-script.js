/**
 * 마포청소년센터 유스나루 예약 시스템 - 구글 스프레드시트 연동 Apps Script (고도화 버전)
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
    
    var lastRow = sheet.getLastRow();
    var lastColumn = sheet.getLastColumn();
    var data = sheet.getRange(1, 1, lastRow, lastColumn).getValues();
    
    var startRowIdx = -1;
    var endRowIdx = -1;
    
    // 요일 범위 찾기
    for (var i = 0; i < data.length; i++) {
      var rowStr = data[i].join(" ");
      if (rowStr.indexOf(day) !== -1) {
        startRowIdx = i + 1;
        for (var j = i + 1; j < data.length; j++) {
          var nextRowStr = data[j].join(" ");
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
    
    // 방(Column) 찾기
    var roomColIdx = -1;
    for (var r = startRowIdx; r < startRowIdx + 4; r++) {
      if (r > lastRow) break;
      var headerRow = data[r - 1];
      for (var c = 0; c < headerRow.length; c++) {
        var cellVal = String(headerRow[c]).replace(/\s+/g, "");
        var targetRoom = room.replace(/\s+/g, "");
        if (cellVal && (cellVal.indexOf(targetRoom) !== -1 || targetRoom.indexOf(cellVal) !== -1)) {
          roomColIdx = c + 1;
          break;
        }
      }
      if (roomColIdx !== -1) break;
    }
    
    if (roomColIdx === -1) {
      return ContentService.createTextOutput(JSON.stringify({ status: "error", message: "공간 '" + room + "' 열을 찾을 수 없습니다." }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    // 시간(Row) 찾기
    var targetRowIdx = -1;
    for (var r = startRowIdx; r <= endRowIdx; r++) {
      var cellVal = String(data[r - 1][0]).replace(/\s+/g, "");
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
    
    var cell = sheet.getRange(targetRowIdx, roomColIdx);
    
    // 셀 병합 영역 여부 확인 (만약 병합되어 있다면 좌상단 셀을 기준으로 작업)
    if (cell.isPartOfMerge()) {
      var mergedRanges = cell.getMergedRanges();
      if (mergedRanges && mergedRanges.length > 0) {
        cell = mergedRanges[0].getCell(1, 1);
      }
    }
    
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
      cell.clearContent();
    }
    
    return ContentService.createTextOutput(JSON.stringify({ status: "success", info: "시트 연동 완료" }))
      .setMimeType(ContentService.MimeType.JSON);
      
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ status: "error", message: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// 웹앱 doGet 호출 시 스프레드시트 데이터 반환 (탭 목록 혹은 탭 데이터)
function doGet(e) {
  try {
    // 1. 탭 목록 전체 조회 액션 지원
    if (e.parameter.action === "getTabs") {
      var sheets = SpreadsheetApp.getActiveSpreadsheet().getSheets();
      var tabNames = sheets.map(function(s) { return s.getName(); });
      return ContentService.createTextOutput(JSON.stringify({ tabs: tabNames }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    var activeTabName = e.parameter.activeTabName || getActiveTabFromFirebase() || "2026년 6월";
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(activeTabName);
    if (!sheet) {
      return ContentService.createTextOutput(JSON.stringify({ error: "시트를 찾을 수 없습니다." }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    var lastRow = sheet.getLastRow();
    var lastColumn = sheet.getLastColumn();
    var dataRange = sheet.getRange(1, 1, lastRow, lastColumn);
    var data = dataRange.getValues();
    
    // 2. 셀 병합(Merged Cells) 복구: 병합 영역 내 모든 셀에 좌상단 값 채워넣기
    var mergedRanges = dataRange.getMergedRanges();
    for (var k = 0; k < mergedRanges.length; k++) {
      var mRange = mergedRanges[k];
      var startRow = mRange.getRow();
      var startCol = mRange.getColumn();
      var numRows = mRange.getNumRows();
      var numCols = mRange.getNumColumns();
      
      // 인덱스가 data 배열 범위를 벗어나지 않도록 사전 검사
      if (startRow - 1 < data.length && startCol - 1 < data[startRow - 1].length) {
        var rootValue = data[startRow - 1][startCol - 1];
        if (rootValue !== undefined && rootValue !== null) {
          for (var r = startRow; r < startRow + numRows; r++) {
            if (r - 1 >= data.length) continue; // 행 범위 안전 가드
            for (var c = startCol; c < startCol + numCols; c++) {
              if (data[r - 1] && c - 1 < data[r - 1].length) { // 열 범위 안전 가드
                data[r - 1][c - 1] = rootValue; // 병합 영역 전체에 좌상단 텍스트 전파
              }
            }
          }
        }
      }
    }
    
    var result = {
      sheetName: activeTabName,
      reservations: []
    };
    
    var currentDay = "";
    var rooms = [];
    
    for (var i = 0; i < data.length; i++) {
      var row = data[i];
      var firstCell = String(row[0]).trim();
      var rowStr = row.join(" ");
      
      if (rowStr.indexOf("요일") !== -1 && (rowStr.indexOf("년") !== -1 || rowStr.indexOf("월") !== -1)) {
        currentDay = "";
        if (rowStr.indexOf("월요일") !== -1) currentDay = "월요일";
        else if (rowStr.indexOf("화요일") !== -1) currentDay = "화요일";
        else if (rowStr.indexOf("수요일") !== -1) currentDay = "수요일";
        else if (rowStr.indexOf("목요일") !== -1) currentDay = "목요일";
        else if (rowStr.indexOf("금요일") !== -1) currentDay = "금요일";
        else if (rowStr.indexOf("토요일") !== -1) currentDay = "토요일";
        else if (rowStr.indexOf("일요일") !== -1) currentDay = "일요일";
        
        rooms = [];
        var headerSearchLimit = Math.min(i + 4, data.length);
        for (var hIdx = i + 1; hIdx < headerSearchLimit; hIdx++) {
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
        continue;
      }
      
      if (currentDay && firstCell && firstCell.indexOf(":") !== -1 && firstCell.indexOf("~") !== -1) {
        var timeSlot = firstCell;
        for (var colIdx = 1; colIdx < row.length; colIdx++) {
          var cellContent = String(row[colIdx]).trim();
          var roomName = rooms[colIdx - 1] || "";
          
          if (cellContent && roomName) {
            roomName = roomName.split("(")[0].trim();
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
  
  var bracketIdx = text.indexOf("(");
  if (bracketIdx !== -1) {
    teamName = text.substring(0, bracketIdx).trim();
    var innerText = text.substring(bracketIdx + 1, text.lastIndexOf(")")).trim();
    
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

// 2. 시트 내용 직접 편집 시 Firestore에 실시간 반영 (onEdit Trigger) - 셀 병합 일괄 처리
function onEdit(e) {
  var range = e.range;
  var sheet = range.getSheet();
  var activeTabName = getActiveTabFromFirebase() || "2026년 6월";
  
  if (sheet.getName() !== activeTabName) return;
  
  var startRow = range.getRow();
  var startCol = range.getColumn();
  var numRows = range.getNumRows();
  var numCols = range.getNumColumns();
  var newValue = range.getValue().toString().trim();
  
  // 헤더나 시간대 열 수정은 스킵
  if (startCol === 1 || startRow < 5) return;
  
  var lastRow = sheet.getLastRow();
  var lastColumn = sheet.getLastColumn();
  var data = sheet.getRange(1, 1, lastRow, lastColumn).getValues();
  
  // 요일 찾기 (startRow 기준 위로 올라감)
  var day = "";
  var dayStartRow = -1;
  for (var r = startRow; r > 0; r--) {
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
  
  // 공간 목록 추출
  var rooms = [];
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
  
  // 병합된 모든 개별 셀의 예약 상태를 Firestore에 순차 갱신 (병합 셀 일괄 동기화)
  var weekId = getWeekId(new Date());
  var dayId = getDayId(day);
  
  for (var currR = startRow; currR < startRow + numRows; currR++) {
    for (var currC = startCol; currC < startCol + numCols; currC++) {
      var curTime = data[currR - 1][0].toString().trim();
      var curRoom = rooms[currC - 2] || "";
      if (!curRoom || curTime.indexOf(":") === -1 || curTime.indexOf("~") === -1) continue;
      curRoom = curRoom.split("(")[0].trim();
      
      var resId = (curTime + "-" + curRoom).replace(/\//g, "_");
      var url = "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID + "/databases/(default)/documents/reservations/" + weekId + "/" + dayId + "/" + resId;
      
      var options = {
        method: "patch",
        contentType: "application/json",
        muteHttpExceptions: true
      };
      
      if (newValue === "") {
        var payload = {
          fields: {
            apiToken: { stringValue: SECRET_API_TOKEN },
            teamId: { nullValue: null },
            teamName: { stringValue: "" },
            userName: { stringValue: "" },
            note: { stringValue: "" }
          }
        };
        options.payload = JSON.stringify(payload);
        UrlFetchApp.fetch(url + "?updateMask.fieldPaths=apiToken&updateMask.fieldPaths=teamId&updateMask.fieldPaths=teamName&updateMask.fieldPaths=userName&updateMask.fieldPaths=note", options);
      } else {
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
  }
}

// 요일 텍스트를 dayId로 변경
function getDayId(dayText) {
  var map = { "월요일": "mon", "화요일": "tue", "수요일": "wed", "목요일": "thu", "금요일": "fri", "토요일": "sat", "일요일": "sun" };
  return map[dayText] || "mon";
}

// 등록된 이름 매칭 헬퍼
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

// 주간 ID 생성 헬퍼 함수
function getWeekId(date) {
  var d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
  var week1 = new Date(d.getFullYear(), 0, 4);
  var wn = 1 + Math.round(((d - week1) / 864e5 - 3 + (week1.getDay() + 6) % 7) / 7);
  return d.getFullYear() + "-W" + ("0" + wn).slice(-2);
}
