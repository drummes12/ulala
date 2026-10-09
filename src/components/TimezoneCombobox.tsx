import {
  KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { CaretDown, Check, MagnifyingGlass } from '@phosphor-icons/react'
import { timezoneOffsetLabel } from '../lib/time'

interface TimezoneComboboxProps {
  value: string
  zones: string[]
  onChange: (zone: string) => void
  describedBy?: string
}

export function TimezoneCombobox({
  value,
  zones,
  onChange,
  describedBy
}: TimezoneComboboxProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const filteredZones = useMemo(() => {
    const search = normalizeSearch(query)
    if (!search) return zones
    return zones.filter((zone) =>
      normalizeSearch(
        `${zone} ${zone.replace(/_/g, ' ')} ${timezoneOffsetLabel(zone)}`
      ).includes(search)
    )
  }, [query, zones])

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) closeMenu()
    }

    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [])

  useEffect(() => {
    if (!open) return
    listRef.current
      ?.querySelector(`[data-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, open])

  function openMenu() {
    setQuery('')
    setActiveIndex(Math.max(0, zones.indexOf(value)))
    setOpen(true)
  }

  function closeMenu() {
    setOpen(false)
    setQuery('')
  }

  function selectZone(zone: string) {
    onChange(zone)
    closeMenu()
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!open && ['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) {
      event.preventDefault()
      openMenu()
      return
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      closeMenu()
      return
    }

    if (event.key === 'Tab') {
      closeMenu()
      return
    }

    if (!filteredZones.length) return

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((index) => Math.min(index + 1, filteredZones.length - 1))
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((index) => Math.max(index - 1, 0))
    }

    if (event.key === 'Home') {
      event.preventDefault()
      setActiveIndex(0)
    }

    if (event.key === 'End') {
      event.preventDefault()
      setActiveIndex(filteredZones.length - 1)
    }

    if (event.key === 'Enter') {
      event.preventDefault()
      selectZone(filteredZones[activeIndex])
    }
  }

  const activeId = open
    ? `timezone-option-${filteredZones[activeIndex] ?? 'empty'}`
    : undefined

  return (
    <div className='timezone-combobox' ref={rootRef}>
      <MagnifyingGlass
        className='timezone-search-icon'
        size={17}
        weight='bold'
        aria-hidden
      />
      <input
        value={open ? query : `${value.replace(/_/g, ' ')} · ${timezoneOffsetLabel(value)}`}
        onChange={(event) => {
          setQuery(event.target.value)
          setActiveIndex(0)
          setOpen(true)
        }}
        onFocus={openMenu}
        onKeyDown={handleKeyDown}
        onBlur={(event) => {
          if (!rootRef.current?.contains(event.relatedTarget as Node)) {
            closeMenu()
          }
        }}
        role='combobox'
        aria-expanded={open}
        aria-controls='timezone-listbox'
        aria-autocomplete='list'
        aria-activedescendant={activeId}
        aria-label='Zona horaria del viaje'
        aria-describedby={describedBy}
        autoComplete='off'
        spellCheck={false}
        placeholder='Buscar zona horaria…'
      />
      <CaretDown
        className={`timezone-caret ${open ? 'open' : ''}`}
        size={18}
        weight='bold'
        aria-hidden
      />
      {open ? (
        <div className='timezone-menu'>
          <div
            className='timezone-list'
            id='timezone-listbox'
            ref={listRef}
            role='listbox'
            aria-label='Zonas horarias disponibles'
          >
            {filteredZones.map((zone, index) => (
              <div
                key={zone}
                id={`timezone-option-${zone}`}
                className={`timezone-option ${
                  index === activeIndex ? 'active' : ''
                }`}
                role='option'
                aria-selected={zone === value}
                data-index={index}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => selectZone(zone)}
              >
                <span className='timezone-option-name'>
                  {zone.replace(/_/g, ' ')}
                </span>
                <span className='timezone-option-offset'>
                  {timezoneOffsetLabel(zone)}
                </span>
                {zone === value ? (
                  <Check size={16} weight='bold' aria-hidden />
                ) : null}
              </div>
            ))}
          </div>
          {!filteredZones.length ? (
            <p className='timezone-empty' role='status'>
              No hay zonas que coincidan con “{query}”.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function normalizeSearch(value: string): string {
  return value
    .toLocaleLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/_/g, ' ')
    .trim()
}
