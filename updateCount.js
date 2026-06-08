// scripts/updateCounts.js
import fs from 'fs'

const indexPath = './index.json'
const index = JSON.parse(fs.readFileSync(indexPath, 'utf-8'))

function countFile(filePath) {
	try {
		const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
		return (data.questions || []).length
	} catch (e) {
		console.warn('Не удалось прочитать:', filePath)
		return 0
	}
}

for (const cat of index.categories) {
	let catCount = 0

	for (const topic of cat.topics) {
		let topicCount = 0

		// files топика
		const filesWithCount = topic.files.map(f => {
			const count = countFile(f)
			topicCount += count
			return { path: f, count }
		})
		topic.files = filesWithCount

		// subtopics
		if (topic.subtopics) {
			for (const sub of topic.subtopics) {
				let subCount = 0
				const subFilesWithCount = sub.files.map(f => {
					const count = countFile(f)
					subCount += count
					return { path: f, count }
				})
				sub.files = subFilesWithCount
				sub.count = subCount
				topicCount += subCount
			}
		}

		topic.count = topicCount
		catCount += topicCount
	}

	cat.count = catCount
}

fs.writeFileSync(indexPath, JSON.stringify(index, null, 2))
console.log('✅ index.json обновлён')
