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
 * 6. 시트 -> 웹 실시간 반영은 Apps Script의 [트리거]에서 아래 두 트리거를 추가해야 동작합니다:
 *    - onEdit  : 이벤트 소스 = 스프레드시트 / 이벤트 유형 = 수정 시
 *    - onChange : 이벤트 소스 = 스프레드시트 / 이벤트 유형 = 변경 시 (취소선 등 서식 감지용)
 */

// 🔧 환경 설정 (본인의 Firebase 정보로 변경하세요)
var PROJECT_ID = "youthnarooschedule"; // Firebase 프로젝트 ID
var SECRET_API_TOKEN = "youthnaroo_secret_token_2026"; // 보안용 API 비밀 토큰 (웹앱과 동일해야 함)
// 시트 셀 배경색별 담당자 매핑. 예: "#fce8b2": "평생학습팀 장지혜"
var SHEET_COLOR_OWNERS = {
  "#ffffff": "",
  "#000000": ""
};

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
    var data = getValuesWithMergedCells(dataRange);
    var backgrounds = getBackgroundsWithMergedCells(dataRange);
    var fontLines = getStrikethroughsWithMergedCells(dataRange);

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

        rooms = getRoomsForDay(data, i + 1);
        continue;
      }

      if (currentDay && firstCell && firstCell.indexOf(":") !== -1 && firstCell.indexOf("~") !== -1) {
        var timeSlot = firstCell;
        for (var colIdx = 1; colIdx < row.length; colIdx++) {
          var cellContent = String(row[colIdx]).trim();
          var roomName = rooms[colIdx - 1] || "";

          if (cellContent && roomName) {
            roomName = normalizeSheetRoom(roomName);
            var sheetColor = normalizeSheetColor(backgrounds[i][colIdx]);
            var isStrikethrough = !!(fontLines[i] && fontLines[i][colIdx] === 'line-through');

            // 셀 내용을 줄 단위로 파싱 — 날짜/시간/내용 형식이 있으면 분리
            var lines = cellContent.split(/\n/);
            var addedAny = false;

            for (var li = 0; li < lines.length; li++) {
              var dtParsed = parseDateTimeCell(lines[li]);
              if (dtParsed) {
                var entryDay = dtParsed.parsedDate ? dtParsed.parsedDate.dayText : currentDay;
                result.reservations.push({
                  day: entryDay,
                  time: dtParsed.time,
                  room: roomName,
                  teamName: dtParsed.teamName,
                  userName: dtParsed.userName,
                  note: dtParsed.note,
                  sheetColor: sheetColor,
                  sheetOwner: getOwnerByColor(sheetColor),
                  strikethrough: isStrikethrough
                });
                addedAny = true;
              }
            }

            if (!addedAny) {
              // 기존 방식: 전체 셀 내용을 단일 예약으로 처리
              var parsed = parseCellContent(cellContent);
              result.reservations.push({
                day: currentDay,
                time: timeSlot,
                room: roomName,
                teamName: parsed.teamName,
                userName: parsed.userName,
                note: parsed.note,
                sheetColor: sheetColor,
                sheetOwner: getOwnerByColor(sheetColor),
                strikethrough: isStrikethrough
              });
            }
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

// 셀 내용 파싱 헬퍼 함수 (기존 방식: "팀명 (담당자 - 메모)" 형식)
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

// 날짜/시간/내용 형식 파싱: "6/8 09시~18시 한수협 교육" 또는 "6.8 09:00~18:00 내용"
// 매칭되면 { parsedDate, time, teamName, userName, note } 반환, 아니면 null
function parseDateTimeCell(line) {
  line = (line || "").trim();
  if (!line) return null;

  // 시간 패턴 탐색: "09시~18시" 또는 "09:00~18:00"
  var timeRaw = null;
  var timeNorm = null;

  var mH = line.match(/(\d{1,2})시~(\d{1,2})시/);
  if (mH) {
    timeRaw = mH[0];
    timeNorm = ("0" + mH[1]).slice(-2) + ":00~" + ("0" + mH[2]).slice(-2) + ":00";
  } else {
    var mC = line.match(/(\d{1,2}):(\d{2})~(\d{1,2}):(\d{2})/);
    if (mC) {
      timeRaw = mC[0];
      timeNorm = ("0" + mC[1]).slice(-2) + ":" + mC[2] + "~" + ("0" + mC[3]).slice(-2) + ":" + mC[4];
    }
  }

  if (!timeNorm) return null; // 시간 패턴 없음 → 기존 방식으로 처리

  // 시간 앞부분에서 날짜 탐색: "6/8" 또는 "6.8"
  var beforeTime = line.substring(0, line.indexOf(timeRaw)).trim();
  var parsedDate = null;
  var dateRaw = "";
  var dm = beforeTime.match(/(\d{1,2})[\/\.](\d{1,2})/);
  if (dm) {
    dateRaw = dm[0];
    var year = new Date().getFullYear();
    var month = parseInt(dm[1]);
    var day = parseInt(dm[2]);
    var date = new Date(year, month - 1, day);
    var dayNames = ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"];
    parsedDate = {
      date: date,
      dayText: dayNames[date.getDay()],
      weekId: getWeekId(date)
    };
  }

  // 날짜·시간 제거 후 남은 텍스트가 내용
  var content = line;
  if (dateRaw) content = content.replace(dateRaw, "");
  content = content.replace(timeRaw, "").replace(/\s+/g, " ").trim();

  if (!content) return null; // 내용 없으면 무시

  var parsed = parseCellContent(content);
  return {
    parsedDate: parsedDate,
    time: timeNorm,
    teamName: parsed.teamName,
    userName: parsed.userName,
    note: parsed.note
  };
}

function normalizeSheetTime(timeText) {
  var first = String(timeText || "").split("~")[0].replace(/\s+/g, "").trim();
  var match = first.match(/^(\d{1,2}):(\d{2})$/);
  return match ? ("0" + match[1]).slice(-2) + ":" + match[2] : first;
}

function normalizeSheetRoom(roomText) {
  return String(roomText || "").split("(")[0].replace(/\s+/g, " ").trim();
}

function normalizeSheetColor(color) {
  var c = String(color || "").trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(c) ? c : "";
}

function getOwnerByColor(color) {
  var c = normalizeSheetColor(color);
  return SHEET_COLOR_OWNERS[c] || "";
}

function isTimeCell(value) {
  return String(value || "").replace(/\s+/g, "").indexOf(":") !== -1 &&
    String(value || "").replace(/\s+/g, "").indexOf("~") !== -1;
}

// 셀 병합을 고려한 배경색 2D 배열 반환
function getBackgroundsWithMergedCells(dataRange) {
  var backgrounds = dataRange.getBackgrounds();
  var mergedRanges = dataRange.getMergedRanges();
  for (var k = 0; k < mergedRanges.length; k++) {
    var mRange = mergedRanges[k];
    var startRow = mRange.getRow();
    var startCol = mRange.getColumn();
    var numRows = mRange.getNumRows();
    var numCols = mRange.getNumColumns();
    if (startRow - 1 >= backgrounds.length || startCol - 1 >= backgrounds[startRow - 1].length) continue;
    var rootColor = backgrounds[startRow - 1][startCol - 1];
    for (var r = startRow; r < startRow + numRows; r++) {
      if (r - 1 >= backgrounds.length) continue;
      for (var c = startCol; c < startCol + numCols; c++) {
        if (backgrounds[r - 1] && c - 1 < backgrounds[r - 1].length) backgrounds[r - 1][c - 1] = rootColor;
      }
    }
  }
  return backgrounds;
}

// 셀 병합을 고려한 취소선(strikethrough) 2D 배열 반환
function getStrikethroughsWithMergedCells(dataRange) {
  var fontLines = dataRange.getFontLines();
  var mergedRanges = dataRange.getMergedRanges();
  for (var k = 0; k < mergedRanges.length; k++) {
    var mRange = mergedRanges[k];
    var startRow = mRange.getRow();
    var startCol = mRange.getColumn();
    var numRows = mRange.getNumRows();
    var numCols = mRange.getNumColumns();
    if (startRow - 1 >= fontLines.length || startCol - 1 >= fontLines[startRow - 1].length) continue;
    var rootVal = fontLines[startRow - 1][startCol - 1];
    for (var r = startRow; r < startRow + numRows; r++) {
      if (r - 1 >= fontLines.length) continue;
      for (var c = startCol; c < startCol + numCols; c++) {
        if (fontLines[r - 1] && c - 1 < fontLines[r - 1].length) fontLines[r - 1][c - 1] = rootVal;
      }
    }
  }
  return fontLines;
}

function getValuesWithMergedCells(dataRange) {
  var data = dataRange.getValues();
  var mergedRanges = dataRange.getMergedRanges();
  for (var k = 0; k < mergedRanges.length; k++) {
    var mRange = mergedRanges[k];
    var startRow = mRange.getRow();
    var startCol = mRange.getColumn();
    var numRows = mRange.getNumRows();
    var numCols = mRange.getNumColumns();
    if (startRow - 1 >= data.length || startCol - 1 >= data[startRow - 1].length) continue;
    var rootValue = data[startRow - 1][startCol - 1];
    if (rootValue === undefined || rootValue === null) continue;
    for (var r = startRow; r < startRow + numRows; r++) {
      if (r - 1 >= data.length) continue;
      for (var c = startCol; c < startCol + numCols; c++) {
        if (data[r - 1] && c - 1 < data[r - 1].length) data[r - 1][c - 1] = rootValue;
      }
    }
  }
  return data;
}

function getEditBounds(range) {
  var startRow = range.getRow();
  var startCol = range.getColumn();
  var endRow = startRow + range.getNumRows() - 1;
  var endCol = startCol + range.getNumColumns() - 1;
  var mergedRanges = range.getMergedRanges();
  for (var i = 0; i < mergedRanges.length; i++) {
    var mr = mergedRanges[i];
    startRow = Math.min(startRow, mr.getRow());
    startCol = Math.min(startCol, mr.getColumn());
    endRow = Math.max(endRow, mr.getRow() + mr.getNumRows() - 1);
    endCol = Math.max(endCol, mr.getColumn() + mr.getNumColumns() - 1);
  }
  return { startRow: startRow, startCol: startCol, endRow: endRow, endCol: endCol };
}

function getDayFromRow(data, rowNumber) {
  for (var r = rowNumber; r > 0; r--) {
    var rowStr = data[r - 1].join(" ");
    if (rowStr.indexOf("요일") !== -1 && (rowStr.indexOf("년") !== -1 || rowStr.indexOf("월") !== -1)) {
      var day = "";
      if (rowStr.indexOf("월요일") !== -1) day = "월요일";
      else if (rowStr.indexOf("화요일") !== -1) day = "화요일";
      else if (rowStr.indexOf("수요일") !== -1) day = "수요일";
      else if (rowStr.indexOf("목요일") !== -1) day = "목요일";
      else if (rowStr.indexOf("금요일") !== -1) day = "금요일";
      else if (rowStr.indexOf("토요일") !== -1) day = "토요일";
      else if (rowStr.indexOf("일요일") !== -1) day = "일요일";
      return { day: day, dayStartRow: r };
    }
  }
  return { day: "", dayStartRow: -1 };
}

function getRoomsForDay(data, dayStartRow) {
  var rooms = [];
  var headerSearchLimit = Math.min(dayStartRow + 4, data.length);
  for (var hIdx = dayStartRow; hIdx < headerSearchLimit; hIdx++) {
    var hRow = data[hIdx];
    if (!hRow || isTimeCell(hRow[0])) break;
    var hasRooms = false;
    var tempRooms = [];
    for (var c = 1; c < hRow.length; c++) {
      var rawVal = normalizeSheetRoom(hRow[c]);
      var val = /^\d{1,2}월$/.test(rawVal) ? "" : rawVal;
      tempRooms.push(val);
      if (val) hasRooms = true;
    }
    if (hasRooms) rooms = tempRooms;
  }
  return rooms;
}

function fetchFirestore(url, options) {
  options = options || {};
  options.muteHttpExceptions = true;
  options.headers = options.headers || {};
  options.headers.Authorization = "Bearer " + ScriptApp.getOAuthToken();
  var res = UrlFetchApp.fetch(url, options);
  var code = res.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error("Firestore sync failed (" + code + "): " + res.getContentText());
  }
  return res;
}

function upsertReservationDoc(weekId, dayId, resId, parsed) {
  var url = "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID + "/databases/(default)/documents/reservations/" + weekId + "/" + dayId + "/" + encodeURIComponent(resId);
  var payload = {
    fields: {
      apiToken: { stringValue: SECRET_API_TOKEN },
      teamId: { stringValue: getTeamIdByName(parsed.teamName) || "external" },
      teamName: { stringValue: parsed.teamName },
      userName: { stringValue: parsed.userName },
      note: { stringValue: parsed.note },
      sheetColor: { stringValue: parsed.sheetColor || "" },
      sheetOwner: { stringValue: parsed.sheetOwner || "" },
      isFixed: { booleanValue: false },
      strikethrough: { booleanValue: !!parsed.strikethrough }
    }
  };
  fetchFirestore(url + "?updateMask.fieldPaths=apiToken&updateMask.fieldPaths=teamId&updateMask.fieldPaths=teamName&updateMask.fieldPaths=userName&updateMask.fieldPaths=note&updateMask.fieldPaths=sheetColor&updateMask.fieldPaths=sheetOwner&updateMask.fieldPaths=isFixed&updateMask.fieldPaths=strikethrough", {
    method: "patch",
    contentType: "application/json",
    payload: JSON.stringify(payload)
  });
}

function deleteReservationDoc(weekId, dayId, resId) {
  var url = "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID + "/databases/(default)/documents/reservations/" + weekId + "/" + dayId + "/" + encodeURIComponent(resId);
  try {
    fetchFirestore(url, { method: "delete" });
  } catch (err) {
    if (String(err).indexOf("(404)") === -1) throw err;
  }
}

// 2. 시트 내용 직접 편집 시 Firestore에 실시간 반영 (onEdit Trigger) - 셀 병합 일괄 처리
function onEdit(e) {
  if (!e || !e.range) return;
  var range = e.range;
  var sheet = range.getSheet();
  var activeTabName = getActiveTabFromFirebase() || "2026년 6월";

  if (sheet.getName() !== activeTabName) return;

  var bounds = getEditBounds(range);
  var startRow = bounds.startRow;
  var startCol = bounds.startCol;
  var endRow = bounds.endRow;
  var endCol = bounds.endCol;

  // 헤더나 시간대 열 수정은 스킵
  if (startCol === 1 || startRow < 5) return;

  var lastRow = sheet.getLastRow();
  var lastColumn = sheet.getLastColumn();
  var dataRange = sheet.getRange(1, 1, lastRow, lastColumn);
  var data = getValuesWithMergedCells(dataRange);
  var backgrounds = getBackgroundsWithMergedCells(dataRange);

  var weekId = getWeekId(new Date());

  for (var currR = startRow; currR <= endRow; currR++) {
    var dayInfo = getDayFromRow(data, currR);
    if (!dayInfo.day || dayInfo.dayStartRow === -1) continue;
    var dayId = getDayId(dayInfo.day);
    var rooms = getRoomsForDay(data, dayInfo.dayStartRow);
    var curTimeRaw = String(data[currR - 1][0] || "").trim();
    if (curTimeRaw.indexOf(":") === -1 || curTimeRaw.indexOf("~") === -1) continue;
    var cleanTime = normalizeSheetTime(curTimeRaw);

    for (var currC = startCol; currC <= endCol; currC++) {
      var curRoom = rooms[currC - 2] || "";
      if (!curRoom) continue;
      curRoom = normalizeSheetRoom(curRoom);
      var resId = (cleanTime + "-" + curRoom).replace(/\//g, "_");

      var cellValue = String(data[currR - 1][currC - 1] || "").trim();
      // 취소선 여부 확인 (onEdit는 값 변경 시만 호출됨; 서식 전용 변경은 onChange에서 처리)
      var isStrikethrough = false;
      try {
        isStrikethrough = (sheet.getRange(currR, currC).getFontLine() === 'line-through');
      } catch (ignored) {}

      if (cellValue === "") {
        deleteReservationDoc(weekId, dayId, resId);
      } else {
        var parsed = parseCellContent(cellValue);
        var sheetColor = normalizeSheetColor(backgrounds[currR - 1][currC - 1]);
        parsed.sheetColor = sheetColor;
        parsed.sheetOwner = getOwnerByColor(sheetColor);
        parsed.strikethrough = isStrikethrough;
        upsertReservationDoc(weekId, dayId, resId, parsed);
      }
    }
  }
}

// 3. 서식 변경(취소선 적용/해제 등) 감지 — onChange 설치형 트리거 필요
// Apps Script 편집기 > 트리거 > 추가 > 이벤트 소스: 스프레드시트 / 이벤트: 변경 시 / 함수: onChange
function onChange(e) {
  if (!e || e.changeType !== 'FORMAT') return;
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var activeTabName = getActiveTabFromFirebase() || "2026년 6월";
  if (sheet.getName() !== activeTabName) return;

  var lastRow = sheet.getLastRow();
  var lastColumn = sheet.getLastColumn();
  if (lastRow < 1 || lastColumn < 1) return;

  var dataRange = sheet.getRange(1, 1, lastRow, lastColumn);
  var data = getValuesWithMergedCells(dataRange);
  var backgrounds = getBackgroundsWithMergedCells(dataRange);
  var fontLines = getStrikethroughsWithMergedCells(dataRange);

  var weekId = getWeekId(new Date());
  var currentDay = "";
  var rooms = [];

  for (var i = 0; i < data.length; i++) {
    var row = data[i];
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
      rooms = getRoomsForDay(data, i + 1);
      continue;
    }

    var firstCell = String(row[0]).trim();
    if (!currentDay || firstCell.indexOf(":") === -1 || firstCell.indexOf("~") === -1) continue;

    var dayId = getDayId(currentDay);
    var cleanTime = normalizeSheetTime(firstCell);

    for (var colIdx = 1; colIdx < row.length; colIdx++) {
      var roomName = rooms[colIdx - 1] || "";
      if (!roomName) continue;
      roomName = normalizeSheetRoom(roomName);
      var resId = (cleanTime + "-" + roomName).replace(/\//g, "_");
      var cellValue = String(data[i][colIdx] || "").trim();
      var isStrikethrough = !!(fontLines[i] && fontLines[i][colIdx] === 'line-through');

      if (cellValue === "") {
        deleteReservationDoc(weekId, dayId, resId);
      } else {
        var parsed = parseCellContent(cellValue);
        var sheetColor = normalizeSheetColor(backgrounds[i][colIdx]);
        parsed.sheetColor = sheetColor;
        parsed.sheetOwner = getOwnerByColor(sheetColor);
        parsed.strikethrough = isStrikethrough;
        upsertReservationDoc(weekId, dayId, resId, parsed);
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
    "나루지기": "narujigi",
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
    var res = fetchFirestore(url, { method: "get" });
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
