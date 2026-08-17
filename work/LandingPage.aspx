<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Today's Highlight</title>
  </head>
  <body>
    <a href="/StudentHome.aspx">Go to Home Page</a>
    <script>
      window.chrome = {
        storage: {
          local: { get(defaults, callback) { callback(defaults); } },
          onChanged: { addListener() {} },
        },
      };
    </script>
    <script>
      window.setTimeout(() => {
        const script = document.createElement("script");
        script.src = "../outputs/cuims-clear-firefox/content.js?v=4";
        document.body.append(script);
      }, 10000);
    </script>
  </body>
</html>
