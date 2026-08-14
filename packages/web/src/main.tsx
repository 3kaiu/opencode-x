import "./styles.css"
import { render } from "solid-js/web"
import { App } from "./app"
import { DataProvider } from "./context/client"

const root = document.getElementById("root")
if (!root) throw new Error("missing #root")

render(
  () => (
    <DataProvider>
      <App />
    </DataProvider>
  ),
  root,
)