// Paints the chosen theme before the popup's first frame.
CuimsThemes.applyToPopup(document.documentElement, CuimsThemes.mirrored());
CuimsThemes.load().then((id) => CuimsThemes.applyToPopup(document.documentElement, id));
