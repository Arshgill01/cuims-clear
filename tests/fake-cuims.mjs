// In-memory students.cuchd.in: signed-out pages land on Login.aspx, the
// two-step login, the captcha image, and the attendance and timetable pages.
// Markup mirrors the live login forms and the saved attendance page.

const ORIGIN = "https://students.cuchd.in";

export const SUMMARY = [
  { Code: "24CSP-305", Title: "Competitive Coding-II", Total_Delv: "32", Total_Attd: "26", EligibilityDelivered: "32", EligibilityAttended: "26", EncryptCode: "enc305" },
  { Code: "24CST-302", Title: "Computer Networks", Total_Delv: "12", Total_Attd: "11", EligibilityDelivered: "12", EligibilityAttended: "11", EncryptCode: "enc302" },
  { Code: "24TDT-312", Title: "Aptitude-III", Total_Delv: "16", Total_Attd: "16", EligibilityDelivered: "16", EligibilityAttended: "16", EncryptCode: "enc312" },
];

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
} = {}) {
  const state = { signedIn, requests: [], uidPosts: 0, loginPosts: 0, captchaReads: 0, attendanceLoads: 0, reportId };

  async function fetchImpl(target, options = {}) {
    const url = new URL(target);
    const method = (options.method || "GET").toUpperCase();
    const body = options.body ? String(options.body) : "";
    state.requests.push(`${method} ${url.pathname}`);
    const path = url.pathname.toLowerCase();
    const login = () => response(`${ORIGIN}/Login.aspx`, 200, UID_PAGE);

    if (path === "/" && method === "GET") return response(`${ORIGIN}/`, 200, UID_PAGE);
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
      return response(`${ORIGIN}/StudentHome.aspx`, 200, "<html>home</html>");
    }
    if (!state.signedIn) return login();
    if (path === "/studenthome.aspx") return response(url.href, 200, "<html>home</html>");
    if (path === "/frmstudentcoursewiseattendancesummary.aspx") {
      if (homeInsteadOfAttendance) return response(`${ORIGIN}/StudentHome.aspx`, 200, "<html>home</html>");
      state.attendanceLoads += 1;
      if (state.attendanceLoads > refuseAttendanceAfter) {
        return response(url.href, 200, "<html><head><title>Please wait</title></head><body><p>Too many requests. Please try after some time.</p></body></html>");
      }
      return response(url.href, 200, ATTENDANCE_PAGE.replace("RID+/=", state.reportId));
    }
    if (path.endsWith("/getreport")) {
      if (!body.includes(`UID:'${state.reportId}'`)) return response(url.href, 200, { d: null });
      return response(url.href, 200, { d: JSON.stringify(SUMMARY) });
    }
    if (path.endsWith("/getfullreport")) {
      const course = body.match(/course:'([^']+)'/)?.[1];
      const rows = marksToday.filter((mark) => mark.course === course);
      return response(url.href, 200, { d: { Result: rows.length ? JSON.stringify(rows) : "No Data Found" } });
    }
    if (path === "/frmmytimetable.aspx") return response(url.href, 200, TIMETABLE_HTML);
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
