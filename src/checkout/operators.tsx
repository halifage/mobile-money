import type { JSX } from 'react'
import type { Operator } from '../types.js'

// Source: https://commons.wikimedia.org/wiki/File:MTN_2022_logo.svg (public domain), on MTN yellow.
// MTN and MoMo are trademarks of MTN Group.
function MtnLogo() {
  return (
    <svg className="mm-logo" viewBox="-160 -160 1600 960" role="img" aria-label="MTN MoMo">
      <rect x="-160" y="-160" width="1600" height="960" rx="160" fill="#FFCC00" />
      <path
        fill="#000000"
        d="M640,0C286.5,0,0,143.3,0,320s286.5,320,640,320s640-143.3,640-320S993.5,0,640,0z M640,589.5 C314.4,589.5,50.5,468.8,50.5,320S314.4,50.5,640,50.5s589.5,120.7,589.5,269.5S965.6,589.5,640,589.5z M559.3,263.9v-50.5h180.5 v50.5h-65v162.8h-50.5V263.9H559.3z M957.8,213.3v213.3h-50.5l-91.6-127v127h-50.5V213.3h50.5l91.6,127v-127L957.8,213.3z M320.7,426.7V213.3h50.5l56.1,86.3l56.1-86.3H534v213.3h-50.5V306l-38.3,58.9h-35.6L371.2,306v120.7H320.7z"
      />
    </svg>
  )
}

// Source: https://commons.wikimedia.org/wiki/File:Logo_Orange_Money.svg (public domain), arrow mark only.
// Orange and Orange Money are trademarks of Orange SA.
function OrangeLogo() {
  return (
    <svg className="mm-logo" viewBox="0 0 220.4 115" role="img" aria-label="Orange Money">
      <g transform="translate(.028 -.086)">
        <path
          fill="#000000"
          d="M90.154 11.052H24.335c-3.542 0-6.94 1.413-9.445 3.929a13.44 13.44 0 0 0-3.913 9.484c0 3.558 1.408 6.969 3.913 9.485a13.332 13.332 0 0 0 9.445 3.929h33.596L3.886 92.097a13.442 13.442 0 0 0-3.914 9.486c0 3.558 1.408 6.97 3.914 9.486a13.33 13.33 0 0 0 9.447 3.929c3.543 0 6.941-1.413 9.447-3.929l53.994-54.225v33.683c0 3.558 1.408 6.97 3.913 9.485a13.328 13.328 0 0 0 9.445 3.929c3.543 0 6.941-1.413 9.446-3.929a13.44 13.44 0 0 0 3.912-9.485V24.465c0-3.553-1.404-6.962-3.904-9.477a13.337 13.337 0 0 0-9.432-3.936Z"
        />
        <path
          fill="#FF7900"
          d="M130.236 103.948h65.79c3.542 0 6.94-1.413 9.445-3.929a13.44 13.44 0 0 0 3.913-9.484c0-3.558-1.408-6.969-3.913-9.485a13.328 13.328 0 0 0-9.445-3.929h-33.545l53.994-54.218a13.438 13.438 0 0 0 3.833-9.459 13.441 13.441 0 0 0-3.91-9.428 13.331 13.331 0 0 0-9.387-3.93 13.327 13.327 0 0 0-9.422 3.845l-53.995 54.225V24.465c0-3.557-1.407-6.969-3.913-9.484a13.326 13.326 0 0 0-9.445-3.929 13.329 13.329 0 0 0-9.446 3.929 13.44 13.44 0 0 0-3.912 9.484v66.062a13.48 13.48 0 0 0 1.014 5.136 13.412 13.412 0 0 0 2.896 4.354 13.343 13.343 0 0 0 9.448 3.931Z"
        />
      </g>
    </svg>
  )
}

export const OPERATORS: Record<Operator, { name: string; menuCode?: string; Logo: () => JSX.Element }> = {
  mtn: { name: 'MTN MoMo', menuCode: '*126#', Logo: MtnLogo },
  // ponytail: no Orange menu code until confirmed (spec §5.4); help shows the "open the app" line instead
  orange: { name: 'Orange Money', Logo: OrangeLogo },
}
