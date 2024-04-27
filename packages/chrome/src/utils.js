export function debounce(fn, wait) {
  let id

  return function (...args) {
    if (id) {
      clearTimeout(id)
      id = undefined
    }

    id = setTimeout(() => {
      fn.call(this, ...args)
      id = undefined
    }, wait)
  }
}
