package local.r2controller;
public final class SliderScale {
 public final double minimum,maximum,step;
 public SliderScale(double minimum,double maximum,double step){if(!Double.isFinite(minimum)||!Double.isFinite(maximum)||!Double.isFinite(step)||maximum<=minimum||step<=0||(maximum-minimum)/step>100000)throw new IllegalArgumentException("Invalid slider range");this.minimum=minimum;this.maximum=maximum;this.step=step;}
 public int maximumProgress(){return (int)Math.ceil((maximum-minimum)/step);}
 public int progress(double value){return (int)Math.max(0,Math.min(maximumProgress(),Math.round((value-minimum)/step)));}
 public double value(int progress){return Math.min(maximum,minimum+Math.max(0,Math.min(maximumProgress(),progress))*step);}
}
