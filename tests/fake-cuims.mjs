// In-memory students.cuchd.in: signed-out pages land on Login.aspx, the
// two-step login, the captcha image, and the attendance and timetable pages.
// Markup mirrors the live login forms and the saved attendance page.

const ORIGIN = "https://students.cuchd.in";

export const SUMMARY = [
  { Code: "24CSP-305", Title: "Competitive Coding-II", Total_Delv: "32", Total_Attd: "26", EligibilityDelivered: "32", EligibilityAttended: "26", EncryptCode: "enc305" },
  { Code: "24CST-302", Title: "Computer Networks", Total_Delv: "12", Total_Attd: "11", EligibilityDelivered: "12", EligibilityAttended: "11", EncryptCode: "enc302" },
  { Code: "24TDT-312", Title: "Aptitude-III", Total_Delv: "16", Total_Attd: "16", EligibilityDelivered: "16", EligibilityAttended: "16", EncryptCode: "enc312" },
];

// The Duty Leave and Medical Leave history grids, as on the live pages.
export function dutyLeavePage(rows = []) {
  const body = rows.map((row) => `<tr><td>${row.id}</td><td>${row.timing || ""}</td><td>Departmental Society Activities</td><td></td><td>${row.type || "Lecture Bases"}</td><td>${row.dated}</td><td>${row.status}</td><td>event</td></tr>`).join("");
  return `<table id="gvHistory"><tr><th>DL_No</th><th>Timing</th><th>Category</th><th>File Name</th><th>Leave_Type</th><th>Dated</th><th>Status</th><th>Remarks</th></tr>${body}</table>`;
}

export function medicalLeavePage(rows = []) {
  const body = rows.map((row, index) => `<tr><td>${index + 1}</td><td>${row.from}</td><td>${row.to}</td><td>unwell</td><td>26271</td><td>${row.from}</td><td>${row.status}</td></tr>`).join("");
  return `<table id="gvMlHistory"><tr><th>SrNo</th><th>FromDate</th><th>ToDate</th><th>ReasonOfML</th><th>Session</th><th>EntryDate</th><th>Status</th></tr>${body}</table>`;
}

export const TIMETABLE_HTML = `<form action="./frmMyTimeTable.aspx"><input type="hidden" name="__VIEWSTATE" value="tt" />
<table id="ContentPlaceHolder1_gvMyTimeTable">
<tr><th scope="col">Timing</th><th scope="col">Mon</th><th scope="col">Tue</th></tr>
<tr><td>09:40 - 10:20 AM</td><td>24CSP-305:P :: GP-A: By Teacher(E1) at 1-2-C</td><td></td></tr>
<tr><td>1:00 - 1:40 PM</td><td>24CST-302:L :: GP-All: By Teacher(E2) at 1-3-C</td><td>24TDT-312:L :: GP-All</td></tr>
</table>
<table id="ContentPlaceHolder1_gvMyTimeTableDetails">
<tr><th>Course Code</th><th>Title</th></tr>
<tr><td>24CSP-305</td><td>Competitive Coding-II</td></tr>
<tr><td>24CST-302</td><td>Computer Networks</td></tr>
<tr><td>24TDT-312</td><td>Aptitude-III</td></tr>
</table></form>`;

const UID_PAGE = `<form method="post" action="./" id="form1">
<input type="hidden" name="__EVENTTARGET" id="__EVENTTARGET" value="" />
<input type="hidden" name="__EVENTARGUMENT" id="__EVENTARGUMENT" value="" />
<input type="hidden" name="__VIEWSTATE" id="__VIEWSTATE" value="vs-uid&amp;1" />
<input type="hidden" name="__VIEWSTATEGENERATOR" id="__VIEWSTATEGENERATOR" value="C2EE9ABB" />
<input type="hidden" name="hfcurrentbackground" id="hfcurrentbackground" value="bg-token==" />
<input type="hidden" name="hfdata" id="hfdata" />
<input name="txtUserId" type="text" maxlength="15" id="txtUserId" placeholder="Enter User Id" />
<input type="submit" name="btnNext" value="NEXT" id="btnNext" class="btn" name="submit" />
</form>`;

function passwordPage(message = "") {
  return `<form method="post" action="./Login.aspx?identifier1=abc&amp;identifier2=def%3d" id="form1">
<input type="hidden" name="__EVENTTARGET" id="__EVENTTARGET" value="" />
<input type="hidden" name="__VIEWSTATE" id="__VIEWSTATE" value="vs-pass" />
<input type="hidden" name="hfcurrentbackground" id="hfcurrentbackground" value="bg-token-2" />
<input name="txtLoginPassword" type="password" maxlength="15" id="txtLoginPassword" />
<input name="txtcaptcha" type="text" maxlength="6" id="txtcaptcha" placeholder="Enter captcha" />
<img id="imgCaptcha" src="GenerateCaptcha.aspx?639262051827994275" />
<input type="submit" name="btnLogin" value="LOGIN" id="btnLogin" />
</form>${message ? `<script>swal('Error','${message}','error');</script>` : ""}`;
}

const ATTENDANCE_PAGE = `<div id="SortTable"></div><select id="ddlSession"><option selected="selected" value="25262">CurrentSession (25262)</option></select>
<script>setTimeout(function () {getReport('RID+/=','25262');}, 200);</script>`;

function response(url, status, body) {
  return {
    url,
    status,
    async text() {
      return typeof body === "string" ? body : JSON.stringify(body);
    },
    async arrayBuffer() {
      return new TextEncoder().encode(String(body)).buffer;
    },
  };
}

export function fakeCuims({
  signedIn = false,
  password = "secret",
  captcha = "Ab12",
  rejectAs = null,
  homeInsteadOfAttendance = false,
  marksToday = [],
  refuseAttendanceAfter = Infinity,
  reportId = "RID+/=",
  landed = true,
  dutyLeaves = [],
  medicalLeaves = [],
} = {}) {
  // `landed`: CUIMS gives a session menu rights only once the browser's
  // LandingPage step has called ShowLandingPage. Before that, every inner page
  // redirects to error.html.
  const state = { landed, landingCalls: 0, cookiedReports: 0, leavePageLoads: 0, signedIn, requests: [], uidPosts: 0, loginPosts: 0, captchaReads: 0, attendanceLoads: 0, loginPageLoads: 0, reportId };

  async function fetchImpl(target, options = {}) {
    const url = new URL(target);
    const method = (options.method || "GET").toUpperCase();
    const body = options.body ? String(options.body) : "";
    state.requests.push(`${method} ${url.pathname}`);
    const path = url.pathname.toLowerCase();
    // Signed out, CUIMS redirects to Login.aspx. With redirect: "manual" the
    // caller only sees an opaque redirect and the login page is never loaded.
    const login = () => {
      if (options.redirect === "manual") return { ...response(url.href, 0, ""), type: "opaqueredirect" };
      state.loginPageLoads += 1;
      return response(`${ORIGIN}/Login.aspx`, 200, UID_PAGE);
    };

    if (path === "/" && method === "GET") {
      state.loginPageLoads += 1;
      return response(`${ORIGIN}/`, 200, UID_PAGE);
    }
    if (path === "/" && method === "POST") {
      state.uidPosts += 1;
      const fields = new URLSearchParams(body);
      if (fields.get("hfcurrentbackground") !== "bg-token==" || fields.get("__VIEWSTATE") !== "vs-uid&1") return login();
      return response(`${ORIGIN}/Login.aspx?identifier1=abc&identifier2=def=`, 200, passwordPage());
    }
    if (path === "/generatecaptcha.aspx") {
      state.captchaReads += 1;
      return response(url.href, 200, "jpeg-bytes");
    }
    if (path === "/login.aspx" && method === "POST") {
      state.loginPosts += 1;
      const fields = new URLSearchParams(body);
      if (rejectAs === "lockout") return response(url.href, 200, passwordPage("Too many failed attempts. Try after 20 minutes."));
      if (fields.get("txtLoginPassword") !== password || rejectAs === "password") {
        return response(url.href, 200, passwordPage("Invalid UserId or Password"));
      }
      if (fields.get("txtcaptcha") !== captcha || rejectAs === "captcha") return response(url.href, 200, passwordPage("Invalid Captcha"));
      state.signedIn = true;
      state.landed = false;
      return response(`${ORIGIN}/LandingPage.aspx`, 200, "<html>Today's Highlight</html>");
    }
    if (path === "/landingpage.aspx/showlandingpage" && method === "POST") {
      if (!state.signedIn) return login();
      state.landingCalls += 1;
      state.landed = true;
      return response(url.href, 200, { d: "@@0@@StudentHome.aspx" });
    }
    // Like CUIMS, the report methods answer from the ids alone, session or not.
    if (path.endsWith("/getreport")) {
      if (options.credentials !== "omit") state.cookiedReports += 1;
      if (!body.includes(`UID:'${state.reportId}'`)) return response(url.href, 200, { d: null });
      return response(url.href, 200, { d: JSON.stringify(SUMMARY) });
    }
    if (path.endsWith("/getfullreport")) {
      const course = body.match(/course:'([^']+)'/)?.[1];
      const rows = marksToday.filter((mark) => mark.course === course);
      return response(url.href, 200, { d: { Result: rows.length ? JSON.stringify(rows) : "No Data Found" } });
    }
    if (!state.signedIn) return login();
    if (path === "/studenthome.aspx") return response(url.href, 200, "<html>home</html>");
    if (!state.landed && (path === "/frmstudentcoursewiseattendancesummary.aspx" || path === "/frmmytimetable.aspx")) {
      return response(`${ORIGIN}/error.html`, 200, "<html><head><title>UIMS Error</title></head></html>");
    }
    if (path === "/frmstudentcoursewiseattendancesummary.aspx") {
      if (homeInsteadOfAttendance) return response(`${ORIGIN}/StudentHome.aspx`, 200, "<html>home</html>");
      state.attendanceLoads += 1;
      if (state.attendanceLoads > refuseAttendanceAfter) {
        return response(url.href, 200, "<html><head><title>Please wait</title></head><body><p>Too many requests. Please try after some time.</p></body></html>");
      }
      return response(url.href, 200, ATTENDANCE_PAGE.replace("RID+/=", state.reportId));
    }
    if (path === "/frmmytimetable.aspx") return response(url.href, 200, TIMETABLE_HTML);
    if (path === "/frmstudentapplydutyleave.aspx") {
      state.leavePageLoads += 1;
      return response(url.href, 200, dutyLeavePage(dutyLeaves));
    }
    if (path === "/frmstudentmedicalleaveapply.aspx") {
      state.leavePageLoads += 1;
      return response(url.href, 200, medicalLeavePage(medicalLeaves));
    }
    return response(url.href, 404, "not found");
  }

  return { state, fetchImpl };
}

export function memoryStorage(initial = {}) {
  const data = structuredClone(initial);
  return {
    data,
    async get(defaults) {
      const out = {};
      for (const [key, value] of Object.entries(defaults)) out[key] = key in data ? structuredClone(data[key]) : value;
      return out;
    },
    async set(values) {
      Object.assign(data, structuredClone(values));
    },
  };
}
