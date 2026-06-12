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
}

const ActingAsContext = createContext<ActingAsContextValue | null>(null)

export function ActingAsProvider({ children }: { children: ReactNode }) {
  const [actingAs, setActingAsState] = useState(DEFAULT_ID)

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored && /^\d{3}$/.test(stored)) setActingAsState(stored)
  }, [])

  const setActingAs = useCallback((id: string) => {
    setActingAsState(id)
    window.localStorage.setItem(STORAGE_KEY, id)
  }, [])

  const { data, isLoading } = useSWR<{ distributors: Distributor[] }>(
    "/api/distributors",
    fetcher,
    { revalidateOnFocus: false },
  )

  return (
    <ActingAsContext.Provider
      value={{
        actingAs,
        setActingAs,
        distributors: data?.distributors ?? [],
        isLoading,
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
