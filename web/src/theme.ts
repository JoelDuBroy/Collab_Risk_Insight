import { createTheme } from "@mui/material/styles";

export const theme = createTheme({
  palette: {
    mode: "light",
    primary: { main: "#1a6f96", dark: "#155a7a", light: "#3f8fb3" },
    secondary: { main: "#3d5a73" },
    background: {
      default: "#e8eef4",
      paper: "#ffffff",
    },
    text: {
      primary: "#10233a",
      secondary: "#51657a",
    },
    error: { main: "#9b2c2c" },
    warning: { main: "#9a6700" },
    info: { main: "#1f4e79" },
    success: { main: "#1b6b45" },
  },
  typography: {
    fontFamily: '"DM Sans", "Segoe UI", sans-serif',
    h3: { fontWeight: 700, letterSpacing: "-0.03em" },
    h5: { fontWeight: 700, letterSpacing: "-0.02em" },
    h6: {
      fontWeight: 700,
      letterSpacing: "0.04em",
      textTransform: "uppercase",
      fontSize: "0.85rem",
      color: "#51657a",
    },
    button: { textTransform: "none", fontWeight: 600 },
  },
  shape: { borderRadius: 14 },
  components: {
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: "none",
          border: "1px solid rgba(16, 35, 58, 0.1)",
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: { borderRadius: 999, px: 2.5, py: 1.1 },
      },
    },
    MuiTextField: {
      defaultProps: { size: "medium", variant: "outlined" },
    },
  },
});
