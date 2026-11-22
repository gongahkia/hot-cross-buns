import { createContext, useContext, type ParentProps } from "solid-js"
import type { HotCrossBunsClient } from "../hot-cross-buns/client"
const Client = createContext<HotCrossBunsClient>()
export function ClientProvider(props: ParentProps<{ client: HotCrossBunsClient }>) { return <Client.Provider value={props.client}>{props.children}</Client.Provider> }
export function useClient() { const value = useContext(Client); if (!value) throw new Error("Missing Hot Cross Buns client"); return value }
