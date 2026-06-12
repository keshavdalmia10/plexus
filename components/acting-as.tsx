"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react"
import useSWR from "swr"
import type { Distributor } from "@/lib/types"

const STORAGE_KEY = "plexus.actingAs"
const DEFAULT_ID = "001"

export const fetcher = async (url: string) => {
  const res = await fetch(url)
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error ?? `Request failed: ${res.status}`)
  }
  return res.json()
}

interface ActingAsContextValue {
  actingAs: string
  setActingAs: (id: string) => void
  distributors: Distributor[]
  isLoading: boolean
  /** The seller currently being viewed (you). */
  current: Distributor | null
  /** Re-fetch the seller list, e.g. after a plan change. */
  refresh: () => Promise<unknown>
}

const ActingAsContext = createContext<ActingAsContextValue | null>(null)

export function ActingAsProvider({ children }: { children: ReactNode }) {
  const [actingAs, setActingAsState] = useState(DEFAULT_ID)

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored && /^\d{3}$/.test(stored)) setActingAsState(stored)
  }, [])

  const setActingAs = useCallback((id: string) => {
    if (!/^\d{3}$/.test(id)) return
    setActingAsState(id)
    window.localStorage.setItem(STORAGE_KEY, id)
  }, [])

  const { data, isLoading, mutate } = useSWR<{ distributors: Distributor[] }>(
    "/api/distributors",
    fetcher,
    { revalidateOnFocus: false },
  )

  const distributors = data?.distributors ?? []

  return (
    <ActingAsContext.Provider
      value={{
        actingAs,
        setActingAs,
        distributors,
        isLoading,
        current: distributors.find((d) => d.id === actingAs) ?? null,
        refresh: mutate,
      }}
    >
      {children}
    </ActingAsContext.Provider>
  )
}

export function useActingAs(): ActingAsContextValue {
  const ctx = useContext(ActingAsContext)
  if (!ctx) throw new Error("useActingAs must be used within ActingAsProvider")
  return ctx
}
