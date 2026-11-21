import { cn } from "cn"
import {
  SliderFill,
  Slider as SliderPrimitive,
  SliderThumb,
  SliderTrack,
  type SliderProps as SliderPrimitiveProps,
} from "react-aria-components"

type SliderValue = number | number[]
type SliderProps<T extends SliderValue = SliderValue> = Omit<
  SliderPrimitiveProps<T>,
  "className"
> & {
  className?: string
}

/* A continuous value: a ruled line, the travelled part inked in, a hollow handle to hold. */
function Slider<T extends SliderValue = SliderValue>({
  className,
  ...props
}: SliderProps<T>) {
  return (
    <SliderPrimitive
      className={cn(
        "group relative flex h-field w-full touch-none items-center select-none data-vertical:h-full data-vertical:min-h-40 data-vertical:w-field data-vertical:flex-col",
        className
      )}
      data-slot="slider"
      {...props}
    >
      {({ state }) => {
        return (
          <>
            <SliderTrack
              data-slot="slider-track"
              className="relative grow bg-rule-strong select-none group-data-disabled:bg-rule data-horizontal:h-0.5 data-horizontal:w-full data-vertical:h-full data-vertical:w-0.5"
            >
              <SliderFill
                data-slot="slider-range"
                className="absolute bg-ink select-none group-data-disabled:bg-rule-strong data-horizontal:h-full data-vertical:w-full"
              />
            </SliderTrack>
            {state.values.map((_, index) => (
              <SliderThumb
                data-slot="slider-thumb"
                key={index}
                index={index}
                className={cn(
                  "relative block size-3.5 shrink-0 rounded-pill border-2 border-ink bg-panel transition-colors duration-100 select-none group-data-horizontal:top-1/2 group-data-vertical:start-1/2 after:absolute after:-inset-2 data-hovered:bg-well data-dragging:bg-ink data-disabled:border-rule-strong data-disabled:bg-well",
                  "data-focus-visible:outline-2 data-focus-visible:outline-offset-2 data-focus-visible:outline-focus data-focus-visible:outline-solid"
                )}
              />
            ))}
          </>
        )
      }}
    </SliderPrimitive>
  )
}

export { Slider }
