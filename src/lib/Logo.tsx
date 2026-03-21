export function LogoIcon(props: { size?: number }) {
	const size = props.size ?? 20;
	return (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 256 256"
			width={size}
			height={size}
			aria-hidden="true"
		>
			<rect width="256" height="256" rx="56" fill="#0f172a" />
			<rect x="40" y="52" width="120" height="104" rx="24" fill="#e2e8f0" />
			<path
				d="M74 91h52M74 111h70M74 131h40"
				stroke="#0f172a"
				strokeWidth="10"
				strokeLinecap="round"
			/>
			<path
				d="M160 116h25"
				stroke="#38bdf8"
				strokeWidth="12"
				strokeLinecap="round"
			/>
			<path
				d="M174 101l21 15-21 15"
				fill="none"
				stroke="#38bdf8"
				strokeWidth="12"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
			<rect x="155" y="54" width="54" height="54" rx="12" fill="#38bdf8" />
			<rect x="155" y="118" width="54" height="54" rx="12" fill="#1d4ed8" />
			<rect
				x="91"
				y="170"
				width="54"
				height="54"
				rx="12"
				fill="#38bdf8"
				opacity="0.92"
			/>
			<path
				d="M171 71h22M171 91h22"
				stroke="#ffffff"
				strokeWidth="8"
				strokeLinecap="round"
			/>
			<path
				d="M171 135h22M171 155h22"
				stroke="#ffffff"
				strokeWidth="8"
				strokeLinecap="round"
			/>
			<path
				d="M107 187h22M107 207h22"
				stroke="#ffffff"
				strokeWidth="8"
				strokeLinecap="round"
			/>
		</svg>
	);
}
