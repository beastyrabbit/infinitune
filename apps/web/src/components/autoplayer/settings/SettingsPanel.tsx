import type { ReactNode } from "react";

export function SettingsPanel({
	title,
	badge,
	children,
}: {
	title: string;
	badge?: ReactNode;
	children: ReactNode;
}) {
	return (
		<section>
			<div className="flex items-center justify-between mb-4 border-b-2 border-white/10 pb-1">
				<h3 className="text-sm font-black uppercase tracking-widest text-red-500">
					{title}
				</h3>
				{badge}
			</div>
			<div className="space-y-4">{children}</div>
		</section>
	);
}

export function SettingsField({
	label,
	hint,
	trailing,
	children,
}: {
	label: string;
	hint?: string;
	trailing?: ReactNode;
	children: ReactNode;
}) {
	return (
		<div>
			<div className="flex items-center justify-between mb-1">
				{/* biome-ignore lint/a11y/noLabelWithoutControl: label is decorative, control is a child */}
				<label className="text-xs font-bold uppercase text-white/40">
					{label}
				</label>
				{trailing}
			</div>
			{children}
			{hint && (
				<p className="mt-1 text-[10px] font-bold uppercase text-white/20">
					{hint}
				</p>
			)}
		</div>
	);
}
